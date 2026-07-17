using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class WindowsSshChildProcess
{
    private const uint CreateSuspended = 0x00000004;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private const int ProcThreadAttributeHandleList = 0x00020002;
    private const uint Infinite = 0xffffffff;
    private const uint WaitObject0 = 0x00000000;
    private const uint WaitFailed = 0xffffffff;

    internal static int Run(string executablePath, string[] args)
    {
        using (WindowsAnonymousPipeSet pipes = WindowsAnonymousPipeSet.Create())
        {
            IntPtr job = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr inheritedHandles = IntPtr.Zero;
            ProcessInformation process = new ProcessInformation();
            bool processStarted = false;
            bool assignedToJob = false;
            try
            {
                job = CreateKillOnCloseJob();
                StartupInfoEx startup = CreateStartupInfo(pipes, out attributeList, out inheritedHandles);
                StringBuilder commandLine = WindowsCommandLine.Build(executablePath, args);
                uint flags = CreateSuspended | ExtendedStartupInfoPresent | CreateNoWindow;
                if (!CreateProcess(
                    executablePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    flags,
                    IntPtr.Zero,
                    null,
                    ref startup,
                    out process
                ))
                {
                    throw LastWin32("CreateProcessW failed.");
                }
                processStarted = true;
                pipes.CloseChildEndsInParent();

                if (!AssignProcessToJobObject(job, process.Process))
                {
                    throw LastWin32("AssignProcessToJobObject failed.");
                }
                assignedToJob = true;
                pipes.StartPumps();
                if (ResumeThread(process.Thread) == UInt32.MaxValue)
                {
                    throw LastWin32("ResumeThread failed.");
                }

                IntPtr[] waitHandles = new IntPtr[] { process.Process, pipes.PumpFailureHandle };
                uint waitResult = WaitForMultipleObjects(
                    (uint)waitHandles.Length,
                    waitHandles,
                    false,
                    Infinite
                );
                if (waitResult == WaitObject0 + 1)
                {
                    pipes.ThrowIfPumpFailed();
                    throw new IOException("SSH output pump failed without an error detail.");
                }
                if (waitResult == WaitFailed)
                {
                    throw LastWin32("WaitForMultipleObjects failed.");
                }
                if (waitResult != WaitObject0)
                {
                    throw new Win32Exception("Unexpected child-process wait result.");
                }
                uint exitCode;
                if (!GetExitCodeProcess(process.Process, out exitCode))
                {
                    throw LastWin32("GetExitCodeProcess failed.");
                }
                // Why: descendants must not retain output writers and turn normal completion into
                // an unbounded pump wait after the SSH process itself exits.
                CloseOwnedHandle(ref job);
                pipes.CompletePumps();
                return unchecked((int)exitCode);
            }
            finally
            {
                pipes.CloseChildEndsInParent();
                if (process.Thread != IntPtr.Zero)
                {
                    CloseHandle(process.Thread);
                }
                if (process.Process != IntPtr.Zero)
                {
                    if (processStarted && !assignedToJob)
                    {
                        // A suspended child outside the job would otherwise survive setup failure.
                        TerminateProcess(process.Process, 1);
                    }
                    CloseHandle(process.Process);
                }
                // Why: closing the owned job also kills a still-running SSH child on cancellation.
                CloseOwnedHandle(ref job);
                if (attributeList != IntPtr.Zero)
                {
                    DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (inheritedHandles != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(inheritedHandles);
                }
            }
        }
    }

    private static StartupInfoEx CreateStartupInfo(
        WindowsAnonymousPipeSet pipes,
        out IntPtr attributeList,
        out IntPtr inheritedHandles
    )
    {
        IntPtr attributeBytes = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeBytes);
        if (attributeBytes == IntPtr.Zero)
        {
            throw LastWin32("Unable to size the process attribute list.");
        }

        attributeList = Marshal.AllocHGlobal(attributeBytes);
        inheritedHandles = IntPtr.Zero;
        try
        {
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeBytes))
            {
                throw LastWin32("InitializeProcThreadAttributeList failed.");
            }

            inheritedHandles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(inheritedHandles, 0, pipes.StdinRead);
            Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size, pipes.StdoutWrite);
            Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size * 2, pipes.StderrWrite);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                new IntPtr(ProcThreadAttributeHandleList),
                inheritedHandles,
                new IntPtr(IntPtr.Size * 3),
                IntPtr.Zero,
                IntPtr.Zero
            ))
            {
                throw LastWin32("UpdateProcThreadAttribute failed.");
            }

            StartupInfoEx startup = new StartupInfoEx();
            startup.StartupInfo.Size = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.StartupInfo.Flags = StartfUseStdHandles;
            startup.StartupInfo.StandardInput = pipes.StdinRead;
            startup.StartupInfo.StandardOutput = pipes.StdoutWrite;
            startup.StartupInfo.StandardError = pipes.StderrWrite;
            startup.AttributeList = attributeList;
            return startup;
        }
        catch
        {
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
                attributeList = IntPtr.Zero;
            }
            if (inheritedHandles != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(inheritedHandles);
                inheritedHandles = IntPtr.Zero;
            }
            throw;
        }
    }

    private static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw LastWin32("CreateJobObject failed.");
        }
        JobObjectExtendedLimitInformation limits = new JobObjectExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int size = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformationClass,
                buffer,
                (uint)size
            ))
            {
                int error = Marshal.GetLastWin32Error();
                CloseHandle(job);
                throw new Win32Exception(error, "SetInformationJobObject failed.");
            }
            return job;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static Win32Exception LastWin32(string message)
    {
        return new Win32Exception(Marshal.GetLastWin32Error(), message);
    }

    private static void CloseOwnedHandle(ref IntPtr handle)
    {
        if (handle != IntPtr.Zero)
        {
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        internal int Size;
        internal string Reserved;
        internal string Desktop;
        internal string Title;
        internal uint X;
        internal uint Y;
        internal uint XSize;
        internal uint YSize;
        internal uint XCountChars;
        internal uint YCountChars;
        internal uint FillAttribute;
        internal uint Flags;
        internal short ShowWindow;
        internal short Reserved2;
        internal IntPtr Reserved2Pointer;
        internal IntPtr StandardInput;
        internal IntPtr StandardOutput;
        internal IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        internal StartupInfo StartupInfo;
        internal IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        internal IntPtr Process;
        internal IntPtr Thread;
        internal uint ProcessId;
        internal uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        internal long PerProcessUserTimeLimit;
        internal long PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize;
        internal UIntPtr MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass;
        internal uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        internal ulong ReadOperationCount;
        internal ulong WriteOperationCount;
        internal ulong OtherOperationCount;
        internal ulong ReadTransferCount;
        internal ulong WriteTransferCount;
        internal ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        internal JobObjectBasicLimitInformation BasicLimitInformation;
        internal IoCounters IoInfo;
        internal UIntPtr ProcessMemoryLimit;
        internal UIntPtr JobMemoryLimit;
        internal UIntPtr PeakProcessMemoryUsed;
        internal UIntPtr PeakJobMemoryUsed;
    }

    [DllImport(
        "kernel32.dll",
        EntryPoint = "CreateProcessW",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize
    );

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport(
        "kernel32.dll",
        EntryPoint = "CreateJobObjectW",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(
        uint count,
        [In] IntPtr[] handles,
        [MarshalAs(UnmanagedType.Bool)] bool waitAll,
        uint milliseconds
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
