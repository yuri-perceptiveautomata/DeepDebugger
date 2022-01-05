
#include <windows.h>
#include "Shlwapi.h"
#include <tchar.h>
#include <iostream>
#include <fstream>
#include <string>
#include <ctype.h>
#include <filesystem>

using string = std::wstring;

namespace fs = std::filesystem;

string& ltrim(string& s)
{
   auto it = find_if(s.begin(), s.end(), [](TCHAR c) { return !_istspace(c); });
   s.erase(s.begin(), it);
   return s;
}

string& rtrim(string& s)
{
   auto it = find_if(s.rbegin(), s.rend(), [](TCHAR c) { return !_istspace(c); });
   s.erase(it.base(), s.end());
   return s;
}

string& trim(string& s)
{
   return ltrim(rtrim(s));
}

int execute(const string& cmd)
{
   STARTUPINFO si{};
   si.cb = sizeof(si);

   PROCESS_INFORMATION pi{};

   // Start the child process. 
   if (CreateProcess(nullptr,   // No module name (use command line)
      (LPWSTR)cmd.c_str(), // Command line
      NULL,           // Process handle not inheritable
      NULL,           // Thread handle not inheritable
      FALSE,          // Set handle inheritance to FALSE
      0,              // No creation flags
      NULL,           // Use parent's environment block
      NULL,           // Use parent's starting directory 
      &si,            // Pointer to STARTUPINFO structure
      &pi             // Pointer to PROCESS_INFORMATION structure
   )) {
      // Wait until child process exits.
      WaitForSingleObject(pi.hProcess, INFINITE);

      // Close process and thread handles. 
      CloseHandle(pi.hProcess);
      CloseHandle(pi.hThread);

      return 0;
   }

   return 1;
}

#define DEEP_DEBUGGER_PREFIX _T("--deep-debugger-")

int wmain(int argc, TCHAR *argv[])
{
   string space = _T(" "), quote = _T("\"");
   string node_path_switch = DEEP_DEBUGGER_PREFIX _T("nodejs-path");

   string cmdline = GetCommandLine();
   string args = PathGetArgs(cmdline.c_str());
   
   string nodejs_path;

   for (int i = 1; i < argc; ++i) {
      if (argv[i] == node_path_switch) {
         nodejs_path = argv[++i];
      }
   }

   if (nodejs_path.empty()) {
      return 1;
   }

   auto nodejs_path_quoted = quote + trim(nodejs_path) + quote;

   fs::path exe_path(argv[0]);
   string js_path = exe_path.replace_extension(_T(".js")).make_preferred();

   string cmd = string(nodejs_path_quoted) + space + js_path + space + args;
   return execute(cmd);
}
