using System;
using System.Diagnostics;
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

            using (var child = Process.Start(psi))
            {
                if (child == null) return 111;

                var parentIn = Console.OpenStandardInput();
                var parentOut = Console.OpenStandardOutput();

                var inputPump = new Thread(() => {
                    try
                    {
                        parentIn.CopyTo(child.StandardInput.BaseStream);
                        child.StandardInput.Close();
                    }
                    catch { }
                });
                var outputPump = new Thread(() => {
                    try
                    {
                        child.StandardOutput.BaseStream.CopyTo(parentOut);
                        parentOut.Flush();
                    }
                    catch { }
                });

                inputPump.IsBackground = true;
                outputPump.IsBackground = true;
                inputPump.Start();
                outputPump.Start();

                child.WaitForExit();
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
