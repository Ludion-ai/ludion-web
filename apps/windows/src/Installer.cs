using System.Diagnostics;
using Microsoft.Win32;

namespace Ludion.Wallpaper;

/// <summary>
/// 段階 A の入れ方（署名のない1つの .exe）。ダウンロードした .exe を開くと、自分をこの人の場所に写して入る。
/// 管理者の権限は要らない。入れるもの：
/// - %LOCALAPPDATA%\Programs\Ludion\Ludion.exe
/// - ludion:// の住所（HKCU\Software\Classes\ludion）
/// - Windows の起動で始める（HKCU の Run。初めは「始める」）
/// - スタートメニューの Ludion、「アプリ」の一覧から消せるようにする（HKCU の Uninstall）
/// Store（MSIX）から入れたときは、どれも MSIX の決まり（Package/AppxManifest.xml）が受け持つので、ここは使わない。
/// </summary>
internal static class Installer
{
    private const string ProtocolKey = @"Software\Classes\" + Links.Scheme;
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Ludion";
    private const string RunValue = "Ludion";

    public static string InstallDir { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Ludion");

    public static string InstalledExe => Path.Combine(InstallDir, "Ludion.exe");

    private static string ShortcutPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Ludion.lnk");

    private static string CurrentExe => Environment.ProcessPath ?? throw new InvalidOperationException("no process path");

    /// <summary>入れた場所の外（ダウンロードの場所など）で開かれたか。開発のときは LUDION_NO_INSTALL=1 で止める。</summary>
    public static bool ShouldInstall() =>
        !Native.IsPackaged()
        && Environment.GetEnvironmentVariable("LUDION_NO_INSTALL") != "1"
        && !string.Equals(Path.GetFullPath(CurrentExe), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase);

    /// <summary>写して、登録して、入れた方を開く。前の版が動いていれば、終わってもらってから写す。</summary>
    public static void InstallAndLaunch()
    {
        SingleInstance.AskToQuit(TimeSpan.FromSeconds(10));
        Directory.CreateDirectory(InstallDir);
        CopyWithRetry(CurrentExe, InstalledExe);
        // ダウンロードの印（Mark of the Web）を外す。入れる前に本人が「実行」を選んでいる
        try
        {
            File.Delete(InstalledExe + ":Zone.Identifier");
        }
        catch (IOException)
        {
        }
        Register(startWithWindows: !File.Exists(Path.Combine(Settings.Folder, "settings.json")) || IsStartWithWindows());
        Log.Write($"installed {InstalledExe}");
        Process.Start(new ProcessStartInfo(InstalledExe) { UseShellExecute = false, ArgumentList = { "--installed" } });
    }

    private static void CopyWithRetry(string from, string to)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                File.Copy(from, to, overwrite: true);
                return;
            }
            catch (IOException) when (attempt < 20)
            {
                Thread.Sleep(250);
            }
        }
    }

    private static void Register(bool startWithWindows)
    {
        var exe = InstalledExe;
        using (var protocol = Registry.CurrentUser.CreateSubKey(ProtocolKey))
        {
            protocol.SetValue("", "URL:Ludion");
            protocol.SetValue("URL Protocol", "");
            using var icon = protocol.CreateSubKey("DefaultIcon");
            icon.SetValue("", $"\"{exe}\",0");
            using var command = protocol.CreateSubKey(@"shell\open\command");
            command.SetValue("", $"\"{exe}\" \"%1\"");
        }

        SetStartWithWindows(startWithWindows);
        CreateShortcut(exe);

        using var uninstall = Registry.CurrentUser.CreateSubKey(UninstallKey);
        uninstall.SetValue("DisplayName", "Ludion");
        uninstall.SetValue("DisplayIcon", $"\"{exe}\",0");
        uninstall.SetValue("DisplayVersion", Application.ProductVersion.Split('+')[0]);
        uninstall.SetValue("Publisher", "Ludion");
        uninstall.SetValue("URLInfoAbout", Links.Production);
        uninstall.SetValue("InstallLocation", InstallDir);
        uninstall.SetValue("UninstallString", $"\"{exe}\" --uninstall");
        uninstall.SetValue("QuietUninstallString", $"\"{exe}\" --uninstall");
        uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord);
        uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        uninstall.SetValue("EstimatedSize", (int)(new FileInfo(exe).Length / 1024), RegistryValueKind.DWord);
    }

    private static void CreateShortcut(string exe)
    {
        // WScript.Shell（Windows に入っている）でスタートメニューに置く
        var type = Type.GetTypeFromProgID("WScript.Shell");
        if (type is null) return;
        dynamic? shell = null;
        try
        {
            shell = Activator.CreateInstance(type);
            dynamic link = shell!.CreateShortcut(ShortcutPath);
            link.TargetPath = exe;
            link.WorkingDirectory = InstallDir;
            link.IconLocation = exe + ",0";
            link.Description = "Ludion";
            link.Save();
        }
        catch (System.Runtime.InteropServices.COMException error)
        {
            Log.Write($"shortcut: {error.Message}");
        }
        finally
        {
            if (shell is not null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        }
    }

    public static bool IsStartWithWindows()
    {
        using var run = Registry.CurrentUser.OpenSubKey(RunKey);
        return run?.GetValue(RunValue) is string;
    }

    public static void SetStartWithWindows(bool value)
    {
        using var run = Registry.CurrentUser.CreateSubKey(RunKey);
        if (value) run.SetValue(RunValue, $"\"{InstalledExe}\" --startup");
        else run.DeleteValue(RunValue, throwOnMissingValue: false);
    }

    /// <summary>消す（「設定」→「アプリ」から）。登録と設定を消し、少し待ってから .exe の場所も消す。</summary>
    public static void Uninstall()
    {
        SingleInstance.AskToQuit(TimeSpan.FromSeconds(10));
        Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, throwOnMissingSubKey: false);
        Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, throwOnMissingSubKey: false);
        SetStartWithWindows(false);
        try
        {
            File.Delete(ShortcutPath);
        }
        catch (IOException)
        {
        }
        // 動いている自分と、WebView2 が終わるまで使う設定の場所は、終わった後に消してもらう
        var command = $"/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"{InstallDir}\" & rmdir /s /q \"{Settings.Folder}\"";
        Process.Start(new ProcessStartInfo("cmd.exe", command) { CreateNoWindow = true, UseShellExecute = false, WorkingDirectory = Path.GetTempPath() });
    }
}
