#pragma once

#include <span>
#include <string>
#include <utility>
#include <filesystem>
#include <filesystem>

#include "spdlog/spdlog.h"
#include "spdlog/sinks/basic_file_sink.h"

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

inline string_view readUntil(string_view& v, char sep, bool keep_sep = false)
{
   size_t i = v.find(sep);
   string_view ret = v.substr(0, i);
   v.remove_prefix(i == string_view::npos ? v.size() : keep_sep ? i : i + 1);
   return ret;
}

inline string_view readUntil(string_view& v, const string_view& sep, bool keep_sep = false)
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

inline string quote(const string_view& str)
{
   static constexpr string_view mark = _T("\"");
   return join(mark, trim(str), mark);
};

int execute(const string_view& cmd);
string getErrorMessage();

struct cConfig
{
   std::map<string, string> m_params;

   cConfig(const string& session_type, std::span<TCHAR*> args);
   cConfig(const string& session_type, int argc, TCHAR* argv[]);

   void add(const string& key, const string& val);

   bool send();

private:
   string makeConfig();
   bool await();

   std::vector<string> m_cmdline;
   string m_session_type, m_parent_session_id, m_queue, m_hook_queue;
};

inline string_view findValue(const string_view& name, const string_view& buffer)
{
   for (auto s = buffer; !s.empty();) {
      readUntil(s, name);
      string_view retval = ltrim(readUntil(s, _T('\n')));
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

#ifdef NDEBUG

#define LOG(sfmt, ...)
#define LOGX(sfmt, stmt, ...)
#define ENABLE_LOGGING(log, name)

#else

namespace dbg {

   inline static bool s_logging_enabled = false;

   inline std::shared_ptr<spdlog::logger> logger;

   inline void log(const string_view& log_msg)
   {
      if (s_logging_enabled && logger) {
         logger->info(log_msg);
         logger->flush();
      }
   }

   inline void enableLogging(const fs::path& fname, const TCHAR* name, bool enable = true)
   {
      if (enable) {
         if (!logger) {
            string name_str = string(name) + fmt::format(" [{}]", _getpid());
            logger = spdlog::basic_logger_mt(name_str, fname.string().c_str());
         }
         logger->info(_T("Logging started"s));
         logger->info(_T("Command line: "s) + GetCommandLine());
         logger->flush();
      }
      s_logging_enabled = enable;
   }
   inline bool loggingEnabled()
   {
      return s_logging_enabled;
   }
} // namespace dbg

#define LOG(sfmt, ...) if (dbg::loggingEnabled()) dbg::log(fmt::format(_T(sfmt), __VA_ARGS__));
#define LOGX(sfmt, stmt, ...) if (dbg::loggingEnabled()) { stmt; dbg::log(_T(sfmt)::format(sfmt, __VA_ARGS__)); }
#define ENABLE_LOGGING(log, name) dbg::enableLogging(fs::path(argv[0]).replace_filename(log), name)

#endif
