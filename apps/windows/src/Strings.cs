using System.Globalization;

namespace Ludion.Wallpaper;

/// <summary>画面の文。Windows の表示の言語が日本語なら日本語、ほかは英語（サイトと同じ2つ）。</summary>
internal sealed record Strings(
    string Lang,
    string AppName,
    string TrayTitle,
    string Change,
    string Pause,
    string Sound,
    string PauseOnBattery,
    string StartWithWindows,
    string OpenSite,
    string Quit,
    string PickerTitle,
    string NoWebView,
    string Installed,
    string Uninstalled)
{
    private static Strings? current;

    // 下の Japanese と English より後に決める（静的な値は書いた順に作られるため）
    public static Strings Current => current ??= For(CultureInfo.CurrentUICulture);

    public static Strings For(CultureInfo culture) => culture.TwoLetterISOLanguageName == "ja" ? Japanese : English;

    public static readonly Strings Japanese = new(
        Lang: "ja",
        AppName: "Ludion",
        TrayTitle: "Ludion の壁紙",
        Change: "壁紙を変える…",
        Pause: "止める",
        Sound: "音を出す",
        PauseOnBattery: "電池で動いている間は止める",
        StartWithWindows: "Windows の起動で始める",
        OpenSite: "Ludion を開く",
        Quit: "終わる",
        PickerTitle: "壁紙を選ぶ — Ludion",
        NoWebView: "Microsoft Edge WebView2 ランタイムが見つかりません。Microsoft のページから入れてから、もう一度開いてください。",
        Installed: "Ludion を入れました。",
        Uninstalled: "Ludion を消しました。");

    public static readonly Strings English = new(
        Lang: "en",
        AppName: "Ludion",
        TrayTitle: "Ludion wallpaper",
        Change: "Change wallpaper…",
        Pause: "Pause",
        Sound: "Play sound",
        PauseOnBattery: "Pause on battery",
        StartWithWindows: "Start with Windows",
        OpenSite: "Open Ludion",
        Quit: "Quit",
        PickerTitle: "Choose a wallpaper — Ludion",
        NoWebView: "Microsoft Edge WebView2 Runtime was not found. Install it from Microsoft, then open Ludion again.",
        Installed: "Ludion is installed.",
        Uninstalled: "Ludion was removed.");
}
