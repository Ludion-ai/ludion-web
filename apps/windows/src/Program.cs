namespace Ludion.Wallpaper;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        if (args.Contains("--uninstall"))
        {
            Installer.Uninstall();
            return;
        }

        // 段階 A：ダウンロードした .exe を開いたら、入れて、入れた方を開いて終わる
        if (Installer.ShouldInstall())
        {
            Installer.InstallAndLaunch();
            return;
        }

        var command = Command.FromArgs(args);
        using var instance = new SingleInstance();
        if (!instance.IsFirst)
        {
            // 動いている1つに渡して終わる（ludion://wall/<id> や、スタートメニューから開いたとき）
            SingleInstance.Send(command.ForRunningInstance());
            return;
        }
        if (command.What == Command.Kind.Quit) return;

        Application.Run(new App(instance, command));
    }
}
