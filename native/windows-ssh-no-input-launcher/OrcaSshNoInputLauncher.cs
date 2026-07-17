using System;
using System.IO;

internal static class OrcaSshNoInputLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1)
            {
                Console.Error.WriteLine("Usage: orca-ssh-no-input.exe <ssh.exe> [arguments...]");
                return 2;
            }
            string executablePath = Path.GetFullPath(args[0]);
            if (!File.Exists(executablePath))
            {
                Console.Error.WriteLine("Unable to locate the SSH executable at \"{0}\".", executablePath);
                return 2;
            }

            string[] childArgs = new string[args.Length - 1];
            Array.Copy(args, 1, childArgs, 0, childArgs.Length);
            return WindowsSshChildProcess.Run(executablePath, childArgs);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Unable to start the no-input SSH child: {0}", error.Message);
            return 1;
        }
    }
}
