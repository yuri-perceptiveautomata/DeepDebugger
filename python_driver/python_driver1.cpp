
#include <windows.h>
#include "Shlwapi.h"
#include <tchar.h>
#include <iostream>
#include <fstream>
#include <string>
#include <ctype.h>
#include <filesystem>
#include <map>

using string = std::wstring;
using string_view = std::wstring_view;

using ifstream = std::wifstream;

namespace fs = std::filesystem;

template <typename ...T>
inline string join(T&&... args)
{
   string retval;
   retval.reserve((args.size() + ...));
   (retval.append(args), ...);
   return retval;
}

inline string_view read_until(string_view& v, char sep, bool keep_sep = false)
{
   size_t i = v.find(sep);
   string_view ret = v.substr(0, i);
   v.remove_prefix(i == string_view::npos ? v.size() : keep_sep ? i : i + 1);
   return ret;
}

inline string_view read_until(string_view& v, const string_view& sep, bool keep_sep = false)
{
   size_t i = v.find(sep);
   string_view ret = v.substr(0, i);
   v.remove_prefix(i == string_view::npos ? v.size() : keep_sep ? i : i + sep.length());
   return ret;
}

inline string_view ltrim(const string_view &s)
{
   auto it = find_if(s.begin(), s.end(), [](TCHAR c) { return !_istspace(c); });
   return string_view(it, s.end());
}

inline string_view rtrim(const string_view &s)
{
   auto it = find_if(s.rbegin(), s.rend(), [](TCHAR c) { return !_istspace(c); });
   return string_view(s.data(), s.rend() - it);
}

inline string_view trim(const string_view &s)
{
   return ltrim(rtrim(s));
}

int execute(const string_view& cmd)
{
   STARTUPINFO si{};
   si.cb = sizeof(si);

   PROCESS_INFORMATION pi{};

   // Start the child process. 
   if (CreateProcess(nullptr,   // No module name (use command line)
      (LPWSTR)cmd.data(), // Command line
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

// The algorithm is taken from CPython code
string_view find_home_value(const string_view& buffer)
{
   constexpr string_view home(_T("home"));
   for (auto s = buffer; !s.empty();) {
      read_until(s, home);
      string_view retval = ltrim(read_until(s, _T('\n')));
      if (*retval.data() == _T('=')) {
         retval.remove_prefix(1);
         return ltrim(retval);
      }
   }
   return string_view();
}

class cFileContents
{
protected:
   string m_contents;

public:
   void read(const fs::path& fname)
   {
      ifstream inp;
      inp.open(fname, ifstream::in);

      size_t fsize = fs::file_size(fname);
      m_contents.resize(fsize + 1);

      inp.read(&m_contents.front(), fsize);
      m_contents.resize(inp.gcount());
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
   string_view connect_switch = _T("--connect");
   string_view hook_switch = DEEP_DEBUGGER_PREFIX _T("binary-hook");
   string_view node_path_switch = DEEP_DEBUGGER_PREFIX _T("nodejs-path");
   string_view session_name_switch = DEEP_DEBUGGER_PREFIX _T("session-name");
   string_view python_path_switch = DEEP_DEBUGGER_PREFIX _T("python-path");
   string_view env_extension_switch = DEEP_DEBUGGER_PREFIX _T("env-extension");
   string_view space = _T(" ");

   string_view cmdline = GetCommandLine();
   string_view args = PathGetArgs(cmdline.data());
   
   string_view final_args = args;
   auto pos = final_args.find(DEEP_DEBUGGER_PREFIX);
   if (pos > 0) {
      final_args = final_args.substr(0, pos);
   }

   string_view python_path;
   if (auto python_path_ = _wgetenv(_T("DEEPDEBUGGER_PYTHON_PATH"))) {
      python_path = python_path_;
   }

   string_view nodejs_path, hook_path, session_name;

   std::map<string_view, string_view&> switchmap = {
      {python_path_switch, python_path},
      {node_path_switch, nodejs_path},
      {hook_switch, hook_path},
      {session_name_switch, session_name},
   };

   bool launch_debugger = false;
   for (auto arg = argv + 1; *arg; ++arg) {
      if (*arg == connect_switch) {
         launch_debugger = true;
         continue;
      }
      auto it = switchmap.find(*arg);
      if (it != switchmap.end()) {
         it->second = *++arg;
      }
   }

   if (python_path.empty()) {
      return 1;
   }

   auto quote = [](const string_view& str) {
      static constexpr string_view mark = _T("\"");
      return join(mark, trim(str), mark);
   };

   auto python_path_quoted = quote(python_path);

   if (!launch_debugger) {
      string cmd = join(python_path_quoted, space, args);
      return execute(cmd);
   }

   if (hook_path.empty() || nodejs_path.empty()) {
      return 1;
   }

   fs::path python_exe_path(python_path);
   if (!python_exe_path.parent_path().empty()) {
      string_view cfg_name(_T("pyvenv.cfg"));
      fs::path pyenv_cfg_path = python_exe_path;
      pyenv_cfg_path.replace_filename(cfg_name);
      if (!fs::exists(pyenv_cfg_path)) {
         pyenv_cfg_path = pyenv_cfg_path.parent_path();
         pyenv_cfg_path.replace_filename(cfg_name);
      }
      if (fs::exists(pyenv_cfg_path)) {
         cFileContents fc;
         fc.read(pyenv_cfg_path);
         if (auto home = find_home_value(fc); !home.empty()) {
            auto rc = _tputenv_s(_T("__PYVENV_LAUNCHER__"), python_path.data());
            string python_path_string = home / python_exe_path.filename();
            python_path_quoted = quote(python_path_string);
         }
      }
   }

   auto nodejs_path_quoted = quote(nodejs_path);
   auto hook_path_quoted = quote(hook_path);

   string cmd = join(nodejs_path_quoted, space, hook_path_quoted, space, python_path_quoted, space, final_args);

   if (!session_name.empty()) {
      auto session_name_quoted = quote(session_name);
      cmd += join(space, session_name_switch, space, session_name_quoted);
   }

   return execute(cmd);
}
