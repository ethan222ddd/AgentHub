// Live test only. Open one handle, verify creation FILETIME on that SAME handle,
// then terminate only the guard identified by the disposable app's inspector.
using System;
using System.Runtime.InteropServices;
class TerminateOwned {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr p, out long c, out long e, out long k, out long u);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint milliseconds);
  static int Main(string[] args) {
    if (args.Length != 2) return 2;
    if (args[0] == "alive") {
      IntPtr query = OpenProcess(0x100000, false, int.Parse(args[1]));
      if (query == IntPtr.Zero) return 10;
      try { return WaitForSingleObject(query, 0) == 258 ? 0 : 10; }
      finally { CloseHandle(query); }
    }
    IntPtr h = OpenProcess(0x1001, false, int.Parse(args[0]));
    if (h == IntPtr.Zero) return 3;
    try {
      long c,e,k,u;
      if (!GetProcessTimes(h, out c,out e,out k,out u) || c.ToString() != args[1]) return 4;
      return TerminateProcess(h, 137) ? 0 : 5;
    } finally { CloseHandle(h); }
  }
}
