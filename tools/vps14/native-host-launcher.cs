using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

internal static class Program
{
    private const string PowerShell = @"C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe\pwsh.exe";
    private const string Script = @"C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\yandex-native-host.ps1";

    private static bool SafeArg(string value)
    {
        if (String.IsNullOrEmpty(value) || value.Length > 512) return false;
        foreach (char c in value)
        {
            if (Char.IsLetterOrDigit(c)) continue;
            if (":/-_.=".IndexOf(c) >= 0) continue;
            return false;
        }
        return true;
    }

    private static void Trace(string stage)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ReviewActivatorDev", "YandexNativeV4");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "host_v3.trace"),
                DateTime.UtcNow.ToString("O") + " " + stage + Environment.NewLine);
        }
        catch { }
    }

    public static int Main(string[] args)
    {
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = PowerShell;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            var b = new StringBuilder();
            b.Append("-NoLogo -NoProfile -NonInteractive -File \"");
            b.Append(Script);
            b.Append("\"");
            foreach (var arg in args)
            {
                if (!SafeArg(arg)) return 113;
                b.Append(' ');
                b.Append(arg);
            }
            psi.Arguments = b.ToString();

            Trace("START args=" + args.Length);
            using (var child = Process.Start(psi))
            {
                if (child == null) return 111;
                Trace("CHILD_STARTED");

                var parentIn = Console.OpenStandardInput();
                var parentOut = Console.OpenStandardOutput();

                var inputPump = new Thread(() => {
                    try
                    {
                        var buffer = new byte[4096];
                        int read;
                        while ((read = parentIn.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            child.StandardInput.BaseStream.Write(buffer, 0, read);
                            child.StandardInput.BaseStream.Flush();
                            Trace("IN " + read);
                        }
                        child.StandardInput.Close();
                        Trace("IN_EOF");
                    }
                    catch { Trace("IN_ERROR"); }
                });
                var outputPump = new Thread(() => {
                    try
                    {
                        var buffer = new byte[4096];
                        int read;
                        while ((read = child.StandardOutput.BaseStream.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            parentOut.Write(buffer, 0, read);
                            parentOut.Flush();
                            Trace("OUT " + read);
                        }
                        Trace("OUT_EOF");
                    }
                    catch { Trace("OUT_ERROR"); }
                });
                var errorPump = new Thread(() => {
                    try
                    {
                        var buffer = new char[1024];
                        int read;
                        while ((read = child.StandardError.Read(buffer, 0, buffer.Length)) > 0)
                            Trace("ERR " + read);
                    }
                    catch { Trace("ERR_ERROR"); }
                });

                inputPump.IsBackground = true;
                outputPump.IsBackground = true;
                errorPump.IsBackground = true;
                inputPump.Start();
                outputPump.Start();
                errorPump.Start();

                child.WaitForExit();
                Trace("CHILD_EXIT " + child.ExitCode);
                outputPump.Join(2000);
                return child.ExitCode;
            }
        }
        catch
        {
            return 112;
        }
    }
}
