
#include "pch.h"

#ifdef _UNICODE
using string = std::wstring;
using string_view = std::wstring_view;
using ifstream = std::wifstream;
#else
using string = std::string;
using string_view = std::string_view;
using ifstream = std::ifstream;
#endif

namespace fs = std::filesystem;
using namespace std::literals;

using namespace nlohmann;

template <typename ...T>
inline string join(T&&... args)
{
   string retval;
   retval.reserve((string_view(args).length() + ...));
   (retval.append(args), ...);
   return retval;
}

template <typename ...T>
inline string joins(T&&... args)
{
   const auto sep(_T(" "sv));
   size_t count = sizeof...(args);

   string retval;
   retval.reserve((args.length() + ...) + count * sep.length() - 1);
   ((retval.append(args), --count ? retval.append(sep), 0 : 0), ...);
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

inline string_view ltrim(const string_view& s)
{
   auto it = find_if(s.begin(), s.end(), [](TCHAR c) { return !_istspace(c); });
   return string_view(it, s.end());
}

inline string_view rtrim(const string_view& s)
{
   auto it = find_if(s.rbegin(), s.rend(), [](TCHAR c) { return !_istspace(c); });
   return string_view(s.data(), s.rend() - it);
}

inline string_view trim(const string_view& s)
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
      (LPTSTR)cmd.data(), // Command line
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
string_view find_value(const string_view& name, const string_view& buffer)
{
   for (auto s = buffer; !s.empty();) {
      read_until(s, name);
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

namespace dbg {

   static bool s_logging_enabled = false;

   std::shared_ptr<spdlog::logger> logger;

   void log(const string_view& log_msg)
   {
      if (s_logging_enabled && logger) {
         logger->info(log_msg);
         logger->flush();
      }
   }

   void enable_logging(const fs::path& fname, bool enable = true)
   {
      if (enable) {
         if (!logger) {
            logger = spdlog::basic_logger_mt("python driver", fname.string().c_str());
         }
         logger->info(_T("Logging started"s));
         logger->info(_T("Command line:"s) + GetCommandLine());
         logger->flush();
      }
      s_logging_enabled = enable;
   }
   bool logging_enabled()
   {
      return s_logging_enabled;
   }
} // namespace dbg

#define LOG(sfmt, ...) if (dbg::logging_enabled()) dbg::log(fmt::format(_T(sfmt), __VA_ARGS__));
#define LOGX(sfmt, stmt, ...) if (dbg::logging_enabled()) { stmt; dbg::log(_T(sfmt)::format(sfmt, __VA_ARGS__)); }

string get_error_message()
{
   // Retrieve the system error message for the last-error code

   LPVOID lpMsgBuf = nullptr;
   LPVOID lpDisplayBuf = nullptr;
   DWORD dw = GetLastError();

   FormatMessage(
      FORMAT_MESSAGE_ALLOCATE_BUFFER |
      FORMAT_MESSAGE_FROM_SYSTEM |
      FORMAT_MESSAGE_IGNORE_INSERTS,
      NULL,
      dw,
      MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      (LPTSTR)&lpMsgBuf,
      0, NULL);

   string retval((TCHAR*)lpMsgBuf);

   LocalFree(lpMsgBuf);
   LocalFree(lpDisplayBuf);

   return retval;
}

int _tmain(int argc, TCHAR* argv[])
{
   dbg::enable_logging(fs::path(argv[0]).replace_filename(_T("log.txt")));
   string_view connect_switch = _T("--connect");

   string_view python_path;
   auto python_cfg = fs::path(argv[0]).replace_filename(_T("parent.cfg"));
   LOG("python_cfg = {}", python_cfg.string());

   cFileContents fc;
   if (fs::exists(python_cfg)) {
      fc.read(python_cfg);
      if (auto home = find_value(_T("path"), fc); !home.empty()) {
         python_path = home;
         LOG("python_path = {}", python_path);
      }
   }
   if (python_path.empty()) {
      LOG("Exiting because of empty python_path");
      return 1;
   }

   bool launch_debugger = false;
   for (auto arg = argv + 1; *arg; ++arg) {
      LOG(_T("Argument {}"), *arg);
      if (*arg == connect_switch) {
         launch_debugger = true;
         LOG("--connect found, debug session will be launched");
         continue;
      }
   }

   auto quote = [](const string_view& str) {
      static constexpr string_view mark = _T("\"");
      return join(mark, trim(str), mark);
   };

   auto python_path_quoted = quote(python_path);

   string_view cmdline = GetCommandLine();
   string_view args = PathGetArgs(cmdline.data());

   if (!launch_debugger) {
      string cmd = joins(python_path_quoted, args);
      LOG("Executing {}", cmd);
      return execute(cmd);
   }

   if (auto queue_name = _tgetenv(_T("DEEPDEBUGGER_LAUNCHER_QUEUE"))) {
      LOG("Queue name: {}", queue_name);
      HANDLE hPipe = CreateFile(queue_name, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
      if (hPipe == INVALID_HANDLE_VALUE) {
         LOG("Cannot open parent queue, exiting");
         return 1;
      }

      LOG("Queue opened successfully");

      json cfg;
      
      auto session_type = _T("deepdbg-pythonBin");
      LOG("Setting session type to {}", session_type);
      cfg["type"] = session_type;

      LOG("Setting session command line to {}", cmdline);
      cfg["cmdline"] = cmdline;

      LOG("Setting session program path to {}", python_path);
      cfg["program"] = python_path;

      std::list<json> env;
      for (TCHAR** s = environ; *s; s++) {
         string_view value = *s;
         size_t pos = value.find(_T('='));
         string_view name = value.substr(0, pos);
         value.remove_prefix(pos == string_view::npos ? value.size() : pos + 1);
         json& env_var = env.emplace_back();
         //LOG("Adding session env variable: {}={}", name, value);
         env_var[_T("name")] = name;
         env_var[_T("value")] = value;
      }

      LOG("Setting session environment");
      cfg["environment"] = env;

      std::string message = _T("start|") + cfg.dump();
      LOG("Debug session request: {}", message);

      DWORD dwWritten = 0;
      WriteFile(hPipe, message.c_str(), (DWORD)message.length(), &dwWritten, NULL);
      CloseHandle(hPipe);

      auto parent_session_id = _tgetenv(_T("DEEPDEBUGGER_SESSION_ID"));
      if (!parent_session_id) {
         LOG(_T("Cannot retrieve parent session ID, exiting"));
         return 1;
      }
      LOG(_T("Parent session ID retrieved: {}"), parent_session_id);

      string hookQueue = join(queue_name, _T("."), parent_session_id);
      DWORD pipeMode = PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT;
      HANDLE hHookPipe = CreateNamedPipe(hookQueue.c_str(), PIPE_ACCESS_INBOUND, pipeMode, 1, 0, 0, 0, nullptr);
      if (hHookPipe == INVALID_HANDLE_VALUE) {
         LOG("Cannot create child queue {}, exiting ({})", hookQueue, get_error_message());
         return 1;
      }
      LOG("Child queue created successfully: {}", hookQueue);

      hPipe = CreateFile(queue_name, GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL);
      if (hPipe == INVALID_HANDLE_VALUE) {
         LOG("Cannot open child queue {}, exiting ({})", hookQueue, get_error_message());
         return 1;
      }

      string buf;
      buf.reserve(100);
      size_t rlen = 0;
      if (!ReadFile(hPipe, buf.data(), (DWORD)buf.capacity(), (DWORD*)&rlen, nullptr) && rlen < buf.capacity()) {
         LOG("Cannot read child queue, exiting ({})", get_error_message());
         return 1;
      }
      buf.resize(rlen);
      LOG("Read from child queue: {}", buf);

      if (buf == _T("stopped")) {
         LOG(_T("Session closed message received"));
      }

      CloseHandle(hPipe);
      CloseHandle(hHookPipe);

      LOG("Success");
      return 0;
   }

   LOG("Exiting because of empty queue name");
   return 1;
}
