using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal sealed class WindowsSshChildIo : IDisposable
{
    private const uint HandleFlagInherit = 0x00000001;
    private const int PumpCompletionTimeoutMilliseconds = 5000;

    private readonly IntPtr stdinRead;
    private readonly Stream stdoutDestination;
    private readonly Stream stderrDestination;
    private IntPtr stdoutWrite;
    private IntPtr stderrWrite;
    private SafeFileHandle stdoutRead;
    private SafeFileHandle stderrRead;
    private Thread stdoutPump;
    private Thread stderrPump;
    private Exception pumpFailure;
    private readonly ManualResetEvent pumpFailureSignal = new ManualResetEvent(false);

    private WindowsSshChildIo(
        IntPtr stdinRead,
        Stream stdoutDestination,
        Stream stderrDestination
    )
    {
        this.stdinRead = stdinRead;
        this.stdoutDestination = stdoutDestination;
        this.stderrDestination = stderrDestination;
    }

    internal IntPtr StdinRead { get { return stdinRead; } }
    internal IntPtr StdoutWrite { get { return stdoutWrite; } }
    internal IntPtr StderrWrite { get { return stderrWrite; } }
    internal IntPtr PumpFailureHandle
    {
        get { return pumpFailureSignal.SafeWaitHandle.DangerousGetHandle(); }
    }

    internal static WindowsSshChildIo Create(
        IntPtr stdinRead,
        Stream stdoutDestination,
        Stream stderrDestination
    )
    {
        WindowsSshChildIo pipes = new WindowsSshChildIo(
            stdinRead,
            stdoutDestination,
            stderrDestination
        );
        try
        {
            SecurityAttributes security = new SecurityAttributes();
            security.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            security.InheritHandle = true;

            IntPtr stdoutReadHandle;
            CreateCheckedPipe(out stdoutReadHandle, out pipes.stdoutWrite, security);
            SetNonInheritable(stdoutReadHandle);
            pipes.stdoutRead = new SafeFileHandle(stdoutReadHandle, true);

            IntPtr stderrReadHandle;
            CreateCheckedPipe(out stderrReadHandle, out pipes.stderrWrite, security);
            SetNonInheritable(stderrReadHandle);
            pipes.stderrRead = new SafeFileHandle(stderrReadHandle, true);
            return pipes;
        }
        catch
        {
            pipes.Dispose();
            throw;
        }
    }

    internal void CloseChildEndsInParent()
    {
        CloseOwnedHandle(ref stdoutWrite);
        CloseOwnedHandle(ref stderrWrite);
    }

    internal void StartPumps()
    {
        SafeFileHandle stdoutHandle = stdoutRead;
        stdoutRead = null;
        stdoutPump = StartPump(stdoutHandle, stdoutDestination, "stdout");

        SafeFileHandle stderrHandle = stderrRead;
        stderrRead = null;
        stderrPump = StartPump(stderrHandle, stderrDestination, "stderr");
    }

    internal void CompletePumps()
    {
        Stopwatch deadline = Stopwatch.StartNew();
        if (!JoinPump(stdoutPump, deadline) || !JoinPump(stderrPump, deadline))
        {
            throw new TimeoutException("SSH output pumps did not settle within 5 seconds.");
        }
        ThrowIfPumpFailed();
    }

    internal void ThrowIfPumpFailed()
    {
        Exception failure;
        lock (this)
        {
            failure = pumpFailure;
        }
        if (failure != null)
        {
            throw new IOException("Unable to relay SSH output.", failure);
        }
    }

    public void Dispose()
    {
        CloseChildEndsInParent();
        if (stdoutRead != null)
        {
            stdoutRead.Dispose();
            stdoutRead = null;
        }
        if (stderrRead != null)
        {
            stderrRead.Dispose();
            stderrRead = null;
        }
        Stopwatch deadline = Stopwatch.StartNew();
        JoinPump(stdoutPump, deadline);
        JoinPump(stderrPump, deadline);
        pumpFailureSignal.Dispose();
    }

    private Thread StartPump(SafeFileHandle sourceHandle, Stream destination, string name)
    {
        Thread thread = new Thread(delegate()
        {
            try
            {
                using (FileStream source = new FileStream(sourceHandle, FileAccess.Read, 4096, false))
                {
                    source.CopyTo(destination);
                    destination.Flush();
                }
            }
            catch (Exception error)
            {
                RecordPumpFailure(error);
            }
        });
        thread.Name = "Orca SSH " + name + " pump";
        thread.IsBackground = true;
        try
        {
            thread.Start();
            return thread;
        }
        catch
        {
            sourceHandle.Dispose();
            throw;
        }
    }

    private void RecordPumpFailure(Exception error)
    {
        lock (this)
        {
            if (pumpFailure == null)
            {
                pumpFailure = error;
            }
        }
        try
        {
            pumpFailureSignal.Set();
        }
        catch (ObjectDisposedException)
        {
            // The launcher is already leaving after its bounded disposal wait.
        }
    }

    private static bool JoinPump(Thread pump, Stopwatch deadline)
    {
        if (pump == null)
        {
            return true;
        }
        int remaining = PumpCompletionTimeoutMilliseconds - (int)deadline.ElapsedMilliseconds;
        return remaining > 0 && pump.Join(remaining);
    }

    private static void CreateCheckedPipe(
        out IntPtr readHandle,
        out IntPtr writeHandle,
        SecurityAttributes security
    )
    {
        if (!CreatePipe(out readHandle, out writeHandle, ref security, 0))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreatePipe failed.");
        }
    }

    private static void SetNonInheritable(IntPtr handle)
    {
        if (!SetHandleInformation(handle, HandleFlagInherit, 0))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(handle);
            throw new Win32Exception(error, "SetHandleInformation failed.");
        }
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
    private struct SecurityAttributes
    {
        internal int Length;
        internal IntPtr SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] internal bool InheritHandle;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(
        out IntPtr readPipe,
        out IntPtr writePipe,
        ref SecurityAttributes pipeAttributes,
        uint size
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
