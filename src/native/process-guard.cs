// Windows 10/11 lifetime ownership only. This is NOT a filesystem/network sandbox.
// Build with the OS .NET Framework compiler; never log bootstrap argv or environment.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Collections.Generic;

internal static class ProcessGuard {
    const uint SYNCHRONIZE = 0x100000, QUERY_LIMITED = 0x1000, INFINITE = 0xffffffff;
    const uint KILL_ON_CLOSE = 0x2000, CREATE_SUSPENDED = 4, CREATE_NO_WINDOW = 0x08000000, EXTENDED_STARTUPINFO = 0x80000;
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint low, high; public long Value { get { return ((long)high << 32) | low; } } }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long perProcess, perJob; public uint flags; public UIntPtr minWorking, maxWorking; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo { public int cb; public string reserved, desktop, title; public uint x, y, xSize, ySize, xChars, yChars, fill, flags; public short show, reserved2; public IntPtr reservedPtr, stdin, stdout, stderr; }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ProcessEntry { public uint size, usage, pid; public UIntPtr heap; public uint module, threads, parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exe; }
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int type);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
    public sealed class Launch { public int parentPid { get; set; } public string parentCreation { get; set; } public string file { get; set; } public string[] args { get; set; } }
    static string stage = "bootstrap";
    static void Check(bool ok) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    static long Created(IntPtr process) { FileTime c, e, k, u; Check(GetProcessTimes(process, out c, out e, out k, out u)); return c.Value; }
    static bool IsActualParent(int pid) {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0); Check(snapshot != new IntPtr(-1));
        try {
            var entry = new ProcessEntry(); entry.size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32FirstW(snapshot, ref entry)) do { if (entry.pid == GetCurrentProcessId()) return entry.parent == (uint)pid; } while (Process32NextW(snapshot, ref entry));
            return false;
        } finally { CloseHandle(snapshot); }
    }
    static string Quote(string value) {
        if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException();
        var b = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') b.Append('\\', slashes * 2 + 1).Append('"');
            else b.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return b.Append('\\', slashes * 2).Append('"').ToString();
    }
    static string Bootstrap() {
        // Exactly one byte at a time: a StreamReader could consume the child's first prompt.
        var bytes = new List<byte>(); Stream input = Console.OpenStandardInput();
        for (int i = 0; i < 262144; i++) {
            int c = input.ReadByte(); if (c < 0) throw new EndOfStreamException();
            if (c == 10) return new UTF8Encoding(false, true).GetString(bytes.ToArray());
            bytes.Add((byte)c);
        }
        throw new InvalidDataException();
    }
    public static int Main(string[] argv) {
        IntPtr parent = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero, handlesMemory = IntPtr.Zero;
        bool attributesReady = false, assigned = false;
        ProcessInfo child = new ProcessInfo();
        try {
            if (argv.Length == 2 && argv[0] == "identity") {
                parent = OpenProcess(SYNCHRONIZE | QUERY_LIMITED, false, Int32.Parse(argv[1]));
                Check(parent != IntPtr.Zero);
                Console.Write(Created(parent).ToString(System.Globalization.CultureInfo.InvariantCulture));
                return 0;
            }
            bool owner = argv.Length == 1 && argv[0] == "owner";
            if (argv.Length != 0 && !owner) throw new ArgumentException();
            var launch = new JavaScriptSerializer().Deserialize<Launch>(Bootstrap());
            if (launch == null || launch.parentPid <= 0 || !IsActualParent(launch.parentPid)) throw new InvalidDataException();
            if (!owner && (launch.args == null || launch.args.Length > 512 || !Path.IsPathRooted(launch.file) || !launch.file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException();
            stage = "parent-identity";
            parent = OpenProcess(SYNCHRONIZE | QUERY_LIMITED | (owner ? 0x101u : 0u), false, launch.parentPid);
            Check(parent != IntPtr.Zero);
            if (Created(parent).ToString(System.Globalization.CultureInfo.InvariantCulture) != launch.parentCreation || WaitForSingleObject(parent, 0) != 258) throw new InvalidDataException();
            stage = "job-create";
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits(); limits.basic.flags = KILL_ON_CLOSE;
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
            if (owner) {
                stage = "app-job-assign"; Check(AssignProcessToJobObject(job, parent));
                Console.Out.WriteLine("{\"ready\":true}"); Console.Out.Flush();
                Check(WaitForSingleObject(parent, INFINITE) == 0);
                return 0;
            }
            // The job and parent handles are not inheritable. Inherit only the three stdio handles.
            var startup = new StartupInfoEx(); startup.startup.cb = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.startup.flags = 0x100 | 1;
            startup.startup.stdin = GetStdHandle(-10); startup.startup.stdout = GetStdHandle(-11); startup.startup.stderr = GetStdHandle(-12);
            var handles = new List<IntPtr>();
            foreach (var handle in new[] { startup.startup.stdin, startup.startup.stdout, startup.startup.stderr }) {
                if (handle == IntPtr.Zero || handle == new IntPtr(-1)) throw new InvalidDataException();
                Check(SetHandleInformation(handle, 1, 1)); if (!handles.Contains(handle)) handles.Add(handle);
            }
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); attributesReady = true;
            handlesMemory = Marshal.AllocHGlobal(handles.Count * IntPtr.Size);
            for (int i = 0; i < handles.Count; i++) Marshal.WriteIntPtr(handlesMemory, i * IntPtr.Size, handles[i]);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handlesMemory, new IntPtr(handles.Count * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            startup.attributes = attributes;
            var command = new StringBuilder(Quote(launch.file)); foreach (var arg in launch.args) command.Append(' ').Append(Quote(arg));
            if (command.Length >= 32767) throw new InvalidDataException();
            stage = "native-create";
            Check(CreateProcessW(launch.file, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO, IntPtr.Zero, null, ref startup, out child));
            stage = "job-assign"; Check(AssignProcessToJobObject(job, child.process)); assigned = true;
            // No native instruction executes until ownership and the parent identity are verified.
            if (WaitForSingleObject(parent, 0) != 258) throw new InvalidDataException();
            var ownedJob = job; var ownedParent = parent;
            var watcher = new Thread(() => { WaitForSingleObject(ownedParent, INFINITE); TerminateJobObject(ownedJob, 130); Environment.Exit(130); });
            watcher.IsBackground = true; watcher.Start();
            stage = "native-resume"; Check(ResumeThread(child.thread) != 0xffffffff);
            stage = "native-wait"; Check(WaitForSingleObject(child.process, INFINITE) == 0);
            uint exit; Check(GetExitCodeProcess(child.process, out exit));
            return unchecked((int)exit);
        } catch (Exception error) {
            var win32 = error as System.ComponentModel.Win32Exception;
            // Constants only: never print argv, bootstrap text, environment, prompts or credentials.
            Console.Error.WriteLine("AgentHub process guard failed: stage=" + stage + " code=" + (win32 == null ? "invalid-input-or-parent" : win32.NativeErrorCode.ToString()));
            return 125;
        } finally {
            if (child.process != IntPtr.Zero && !assigned) TerminateProcess(child.process, 125);
            if (job != IntPtr.Zero) CloseHandle(job); // kills owned descendants, even after native root exit
            if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
            if (child.process != IntPtr.Zero) CloseHandle(child.process);
            if (attributesReady) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (handlesMemory != IntPtr.Zero) Marshal.FreeHGlobal(handlesMemory);
            if (parent != IntPtr.Zero) CloseHandle(parent);
        }
    }
}
