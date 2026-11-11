using System.IO.Pipes;
using System.Text;

namespace Ludion.Wallpaper;

/// <summary>アプリへの頼み。ludion://wall/&lt;id&gt; も、スタートメニューから開くのも、動いている1つに届ける。</summary>
internal sealed record Command(Command.Kind What, string? WorkId = null)
{
    /// <summary>
    /// Launch：引数なしで開いた（スタートメニュー、MSIX の「Windows の起動で始める」は引数を渡せない）。
    /// 壁紙を選んでいれば、静かに壁紙を出す。まだなら一覧を出す。もう動いていれば、一覧を出す。
    /// Show：一覧を出す（入れた直後、動いている1つへの頼み）。Startup：Windows の起動（HKCU の Run）。
    /// </summary>
    public enum Kind { Launch, Show, Startup, Wall, Quit }

    /// <summary>開いたときの引数から。ludion:// の住所は形を確かめる（形が違えば、一覧を開くだけ）。</summary>
    public static Command FromArgs(IReadOnlyList<string> args)
    {
        foreach (var arg in args)
        {
            if (arg == "--startup") return new Command(Kind.Startup);
            if (arg == "--installed") return new Command(Kind.Show);
            if (arg == "--quit") return new Command(Kind.Quit);
            if (Links.ParseProtocol(arg) is { } id) return new Command(Kind.Wall, id);
            if (arg.StartsWith(Links.Scheme + ":", StringComparison.OrdinalIgnoreCase)) return new Command(Kind.Show);
        }
        return new Command(Kind.Launch);
    }

    /// <summary>動いている1つに渡すときの形（引数なしで開いた＝一覧を出してほしい）。</summary>
    public Command ForRunningInstance() => What == Kind.Launch ? new Command(Kind.Show) : this;

    public string Serialize() => What == Kind.Wall ? $"wall {WorkId}" : What.ToString().ToLowerInvariant();

    public static Command? Parse(string? line)
    {
        if (line is null) return null;
        var parts = line.Trim().Split(' ', 2);
        return parts[0] switch
        {
            "show" => new Command(Kind.Show),
            "launch" => new Command(Kind.Launch),
            "startup" => new Command(Kind.Startup),
            "quit" => new Command(Kind.Quit),
            "wall" when parts.Length == 2 && Links.IsWorkId(parts[1]) => new Command(Kind.Wall, parts[1]),
            _ => null,
        };
    }
}

/// <summary>
/// 1つだけ動かす。2つ目は、頼みを1つ目に名前つきパイプで渡して終わる。
/// パイプは、この人（同じ Windows のユーザー）だけがつなげる（PipeOptions.CurrentUserOnly）。
/// </summary>
internal sealed class SingleInstance : IDisposable
{
    private static readonly string Name = $"Ludion.Wallpaper.{Environment.UserName}";
    private static readonly string MutexName = $@"Local\{Name}";
    private static readonly string PipeName = $"{Name}.{System.Diagnostics.Process.GetCurrentProcess().SessionId}";

    private readonly Mutex mutex;
    private readonly CancellationTokenSource stop = new();

    public bool IsFirst { get; }

    public SingleInstance()
    {
        mutex = new Mutex(initiallyOwned: true, MutexName, out var created);
        IsFirst = created;
    }

    /// <summary>頼みを待ち受ける（1つ目だけ）。届いたら UI の流れで onCommand を呼ぶ。</summary>
    public void Listen(SynchronizationContext ui, Action<Command> onCommand)
    {
        _ = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    await using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await server.WaitForConnectionAsync(stop.Token);
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var line = await ReadLineLimitedAsync(reader, stop.Token);
                    if (Command.Parse(line) is { } command) ui.Post(_ => onCommand(command), null);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (IOException error)
                {
                    Log.Write($"pipe: {error.Message}");
                }
            }
        });
    }

    private static async Task<string?> ReadLineLimitedAsync(StreamReader reader, CancellationToken cancel)
    {
        var buffer = new char[256];
        var read = await reader.ReadAsync(buffer.AsMemory(), cancel);
        if (read <= 0) return null;
        var text = new string(buffer, 0, read);
        var end = text.IndexOf('\n');
        return end >= 0 ? text[..end] : text;
    }

    /// <summary>動いている1つに頼みを渡す。届けば true。</summary>
    public static bool Send(Command command, int timeoutMs = 3000)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            client.Connect(timeoutMs);
            var bytes = Encoding.UTF8.GetBytes(command.Serialize() + "\n");
            client.Write(bytes);
            client.Flush();
            return true;
        }
        catch (Exception error) when (error is IOException or TimeoutException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>動いている1つがあれば、終わってもらい、終わるまで待つ（入れ直すとき、消すとき）。</summary>
    public static void AskToQuit(TimeSpan wait)
    {
        if (!Mutex.TryOpenExisting(MutexName, out var existing)) return;
        using (existing)
        {
            Send(new Command(Command.Kind.Quit));
            try
            {
                if (existing.WaitOne(wait)) existing.ReleaseMutex();
            }
            catch (AbandonedMutexException)
            {
            }
        }
    }

    public void Dispose()
    {
        stop.Cancel();
        if (IsFirst)
        {
            try
            {
                mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
            }
        }
        mutex.Dispose();
        stop.Dispose();
    }
}
