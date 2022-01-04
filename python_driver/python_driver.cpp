
#include <windows.h>
#include "Shlwapi.h"
#include <tchar.h>
#include <iostream>
#include <string>
#include <ctype.h>

using string = std::wstring;

string& ltrim(string& s)
{
   auto it = find_if(s.begin(), s.end(), [](TCHAR c) { return !std::isspace(c); });
   s.erase(s.begin(), it);
   return s;
}

string& rtrim(string& s)
{
   auto it = find_if(s.rbegin(), s.rend(), [](TCHAR c) { return !std::isspace(c); });
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
   if (!CreateProcess(nullptr,   // No module name (use command line)
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
      printf("CreateProcess failed (%d).\n", GetLastError());
      return 1;
   }

   // Wait until child process exits.
   WaitForSingleObject(pi.hProcess, INFINITE);

   // Close process and thread handles. 
   CloseHandle(pi.hProcess);
   CloseHandle(pi.hThread);

   return 0;
}

#define DEEP_DEBUGGER_PREFIX _T("--deep-debugger-")

int wmain(int argc, TCHAR *argv[])
{
   string connect_switch = _T("--connect");
   string hook_switch = DEEP_DEBUGGER_PREFIX _T("binary-hook");
   string node_path_switch = DEEP_DEBUGGER_PREFIX _T("nodejs-path");
   string python_path_switch = DEEP_DEBUGGER_PREFIX _T("python-path");
   string space = _T(" "), quote = _T("\"");

   string cmdline = GetCommandLine();
   string args = PathGetArgs(cmdline.c_str());
   
   string final_args = args;
   auto pos = final_args.find(DEEP_DEBUGGER_PREFIX);
   if (pos > 0) {
      final_args = final_args.substr(0, pos);
   }

   LPCTSTR python_path = _wgetenv(_T("DEEPDEBUGGER_PYTHON_PATH")), nodejs_path = nullptr, hook_path = nullptr;

   bool launch_debugger = false;
   for (int i = 1; i < argc; ++i) {
      if (argv[i] == connect_switch) {
         launch_debugger = true;
      }
      if (argv[i] == python_path_switch) {
         python_path = argv[++i];
      }
      if (argv[i] == node_path_switch) {
         nodejs_path = argv[++i];
      }
      if (argv[i] == hook_switch) {
         hook_path = argv[++i];
      }
   }

   if (!python_path) {
      return 1;
   }

   string python_path_string(python_path);
   auto python_path_quoted = quote + trim(python_path_string) + quote;

   if (!launch_debugger) {
      string cmd = string(python_path_quoted) + space + args;
      return execute(cmd);
   }

   if (!hook_path || !nodejs_path) {
      return 1;
   }

   string nodejs_path_string(nodejs_path);
   auto nodejs_path_quoted = quote + trim(nodejs_path_string) + quote;

   string hook_path_string(hook_path);
   auto hook_path_quoted = quote + trim(hook_path_string) + quote;

   string cmd = nodejs_path_quoted + space + hook_path_quoted + space + python_path_quoted + space + final_args;
   return execute(cmd);
}
