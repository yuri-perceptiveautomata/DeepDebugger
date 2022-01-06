
#include <windows.h>
#include "Shlwapi.h"
#include <tchar.h>
#include <iostream>
#include <fstream>
#include <string>
#include <ctype.h>
#include <filesystem>

using string = std::wstring;
using ifstream = std::wifstream;

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

// Taken from Python code
bool find_home_value(LPCTSTR buffer, LPCTSTR *start, int *length)
{
   for (LPCTSTR s = _tcsstr(buffer, _T("home")); s; s = _tcsstr(s + 1, _T("\nhome"))) {
      if (*s == _T('\n')) {
         ++s;
      }
      for (int i = 4; i > 0 && *s; --i, ++s) {
         //
      }

      while (*s && iswspace(*s)) {
         ++s;
      }
      if (*s != _T('=')) {
         continue;
      }

      do {
         ++s;
      } while (*s && iswspace(*s));

      *start = s;
      LPCTSTR nl = _tcschr(s, _T('\n'));
      if (nl) {
         *length = (int)((ptrdiff_t)nl - (ptrdiff_t)s) / sizeof(TCHAR);
      }
      else {
         *length = (int)_tcslen(s);
      }
      return true;
   }
   return false;
}

class cFileContents
{
protected:
   std::vector<TCHAR> m_contents;

public:
   void read(const fs::path& fname, size_t read_size = 0)
   {
      ifstream inp;
      inp.open(fname, ifstream::in);

      size_t fsize = read_size ? read_size : fs::file_size(fname);
      m_contents.resize(fsize + 1);

      auto ss = &m_contents.front();
      inp.read(ss, fsize);
      m_contents[fsize] = 0;
   }

   auto size() const
   {
      return m_contents.size();
   }
   auto begin() const
   {
      return m_contents.cbegin();
   }
   auto end() const
   {
      return m_contents.cend();
   }
};

#define DEEP_DEBUGGER_PREFIX _T("--deep-debugger-")

int wmain(int argc, TCHAR *argv[])
{
   string connect_switch = _T("--connect");
   string hook_switch = DEEP_DEBUGGER_PREFIX _T("binary-hook");
   string node_path_switch = DEEP_DEBUGGER_PREFIX _T("nodejs-path");
   string session_name_switch = DEEP_DEBUGGER_PREFIX _T("session-name");
   string python_path_switch = DEEP_DEBUGGER_PREFIX _T("python-path");
   string env_extension_switch = DEEP_DEBUGGER_PREFIX _T("env-extension");
   string space = _T(" "), quote = _T("\"");

   string cmdline = GetCommandLine();
   string args = PathGetArgs(cmdline.c_str());
   
   string final_args = args;
   auto pos = final_args.find(DEEP_DEBUGGER_PREFIX);
   if (pos > 0) {
      final_args = final_args.substr(0, pos);
   }

   LPCTSTR python_path = _wgetenv(_T("DEEPDEBUGGER_PYTHON_PATH"));
   LPCTSTR nodejs_path = nullptr, hook_path = nullptr, session_name = nullptr;

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
      if (argv[i] == session_name_switch) {
         session_name = argv[++i];
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

   fs::path python_exe_path(python_path_string);
   if (!python_exe_path.parent_path().empty()) {
      LPCTSTR cfg_name = _T("pyvenv.cfg");
      fs::path pyenv_cfg_path = python_exe_path;
      pyenv_cfg_path.replace_filename(cfg_name);
      if (!fs::exists(pyenv_cfg_path)) {
         pyenv_cfg_path = pyenv_cfg_path.parent_path();
         pyenv_cfg_path.replace_filename(cfg_name);
      }
      if (fs::exists(pyenv_cfg_path)) {
         cFileContents fc;
         fc.read(pyenv_cfg_path);
         LPCTSTR s = nullptr;
         int len = 0;
         if (find_home_value(&*fc.begin(), &s, &len)) {
            auto rc = _tputenv_s(_T("__PYVENV_LAUNCHER__"), python_path_string.c_str());
            fs::path home_path(string(s, len));
            python_path_string = home_path / python_exe_path.filename();
            python_path_quoted = quote + trim(python_path_string) + quote;
         }
      }
   }

   string nodejs_path_string(nodejs_path);
   auto nodejs_path_quoted = quote + trim(nodejs_path_string) + quote;

   string hook_path_string(hook_path);
   auto hook_path_quoted = quote + trim(hook_path_string) + quote;

   string cmd = nodejs_path_quoted + space + hook_path_quoted + space + python_path_quoted + space + final_args;

   if (session_name) {
      string session_name_string(session_name);
      auto session_name_quoted = quote + trim(session_name_string) + quote;
      cmd += space + session_name_switch + space + session_name_quoted;
   }

   return execute(cmd);
}
