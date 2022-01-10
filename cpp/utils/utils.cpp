// utils.cpp : Defines the functions for the static library.
//

#include "pch.h"
#include "framework.h"

#include "utils.h"

#include "nlohmann/json.hpp"
using namespace nlohmann;

std::string wstrToUtf8Str(const std::wstring& wstr)
{
   if (!wstr.empty()) {
      int sizeRequired = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, NULL, 0, NULL, NULL);
      if (sizeRequired > 0) {
         std::vector<char> utf8String(sizeRequired);
         int bytesConverted = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, &utf8String[0], (int)utf8String.size(), NULL, NULL);
         if (bytesConverted != 0) {
            return &utf8String[0];
         }
      }
   }
   return {};
}

namespace base64 {
   string Encode(const string_view& data)
   {
      static constexpr char sEncodingTable[] = {
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
        'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
        'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
        'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
        'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
        'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
        'w', 'x', 'y', 'z', '0', '1', '2', '3',
        '4', '5', '6', '7', '8', '9', '+', '/'
      };

      size_t in_len = data.size();
      size_t out_len = 4 * ((in_len + 2) / 3);
      std::string ret(out_len, '\0');
      size_t i;
      char* p = const_cast<char*>(ret.c_str());

      for (i = 0; i < in_len - 2; i += 3) {
         *p++ = sEncodingTable[(data[i] >> 2) & 0x3F];
         *p++ = sEncodingTable[((data[i] & 0x3) << 4) | ((int)(data[i + 1] & 0xF0) >> 4)];
         *p++ = sEncodingTable[((data[i + 1] & 0xF) << 2) | ((int)(data[i + 2] & 0xC0) >> 6)];
         *p++ = sEncodingTable[data[i + 2] & 0x3F];
      }
      if (i < in_len) {
         *p++ = sEncodingTable[(data[i] >> 2) & 0x3F];
         if (i == (in_len - 1)) {
            *p++ = sEncodingTable[((data[i] & 0x3) << 4)];
            *p++ = '=';
         }
         else {
            *p++ = sEncodingTable[((data[i] & 0x3) << 4) | ((int)(data[i + 1] & 0xF0) >> 4)];
            *p++ = sEncodingTable[((data[i + 1] & 0xF) << 2)];
         }
         *p++ = '=';
      }

      return ret;
   }

   string Decode(const string& input, string& out)
   {
      static constexpr unsigned char kDecodingTable[] = {
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 62, 64, 64, 64, 63,
        52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 64, 64, 64, 64, 64, 64,
        64,  0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14,
        15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 64, 64, 64, 64, 64,
        64, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
        41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
        64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64
      };

      size_t in_len = input.size();
      if (in_len % 4 != 0) {
         return "Input data size is not a multiple of 4";
      }

      size_t out_len = in_len / 4 * 3;
      if (input[in_len - 1] == '=') {
         out_len--;
      }
      if (input[in_len - 2] == '=') {
         out_len--;
      }

      out.resize(out_len);

      for (size_t i = 0, j = 0; i < in_len;) {
         uint32_t a = input[i] == '=' ? 0 & i++ : kDecodingTable[static_cast<int>(input[i++])];
         uint32_t b = input[i] == '=' ? 0 & i++ : kDecodingTable[static_cast<int>(input[i++])];
         uint32_t c = input[i] == '=' ? 0 & i++ : kDecodingTable[static_cast<int>(input[i++])];
         uint32_t d = input[i] == '=' ? 0 & i++ : kDecodingTable[static_cast<int>(input[i++])];

         uint32_t triple = (a << 3 * 6) + (b << 2 * 6) + (c << 1 * 6) + (d << 0 * 6);

         if (j < out_len) {
            out[j++] = (triple >> 2 * 8) & 0xFF;
         }
         if (j < out_len) {
            out[j++] = (triple >> 1 * 8) & 0xFF;
         }
         if (j < out_len) {
            out[j++] = (triple >> 0 * 8) & 0xFF;
         }
      }

      return {};
   }

};

cConfig::cConfig(const string& session_type, const string& cmdline)
   : m_session_type(session_type), m_cmdline(cmdline)
{
}

void cConfig::add(const string& key, const string& val)
{
   m_params[key] = val;
}

string cConfig::makeConfig()
{
   json cfg;

   LOG("Setting session type to {}", m_session_type);
   cfg["type"] = base64::Encode(m_session_type);

   LOG("Setting session working dir");
   cfg["cwd"] = base64::Encode(fs::current_path().string());

   LOG("Setting session command line to {}", m_cmdline);
   cfg["cmdline"] = base64::Encode(m_cmdline);

   for (const auto& [key, value] : m_params) {
      cfg[key] = base64::Encode(value);
   }

   size_t size = 0;
   for (TCHAR** s = _tenviron; *s; s++) {
      size += 1 + _tcslen(*s);
   }

   string env;
   env.reserve(2 * size + 1);
   for (TCHAR** s = _tenviron; *s; s++) {
      env += base64::Encode(*s);
      env += _T('-');
   }
   env.shrink_to_fit();

   cfg["environment"] = env;

   LOG("Setting hook queue name");
   cfg["deepDbgHookPipe"] = m_hook_queue;

   string message = _T("start|") + cfg.dump();

   return message;
}

bool cConfig::send()
{
   auto queue_name = _tgetenv(_T("DEEPDEBUGGER_LAUNCHER_QUEUE"));
   if (!queue_name) {
      LOG(_T("Cannot retrieve queue name, exiting"));
      return false;
   }
   m_queue = queue_name;
   LOG("Queue name: {}", m_queue);

   auto parent_session_id = _tgetenv(_T("DEEPDEBUGGER_SESSION_ID"));
   if (!parent_session_id) {
      LOG(_T("Cannot retrieve parent session ID, exiting"));
      return false;
   }
   LOG(_T("Parent session ID retrieved: {}"), parent_session_id);

   m_hook_queue = join(queue_name, _T("."), parent_session_id);

   string message = makeConfig();
   LOG("Debug session request: {}", message);

   HANDLE hPipe = CreateFile(m_queue.c_str(), GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
   if (hPipe == INVALID_HANDLE_VALUE) {
      LOG("Cannot open parent queue, exiting");
      return false;
   }

   LOG("Queue opened successfully");

   DWORD dwWritten = 0;
   WriteFile(hPipe, message.c_str(), (DWORD)message.length(), &dwWritten, NULL);
   CloseHandle(hPipe);

   return await();
}

bool cConfig::await()
{
   DWORD pipeMode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT;
   HANDLE hPipe = CreateNamedPipe(m_hook_queue.c_str(), PIPE_ACCESS_DUPLEX, pipeMode, 1, 1000, 1000, NMPWAIT_USE_DEFAULT_WAIT, nullptr);
   if (hPipe == INVALID_HANDLE_VALUE) {
      LOG("Cannot create child queue {}, exiting ({})", m_hook_queue, getErrorMessage());
      return false;
   }
   LOG("Child queue created successfully: {}", m_hook_queue);

   if (!ConnectNamedPipe(hPipe, NULL)) {
      LOG("Cannot open child queue {}, exiting ({})", m_hook_queue, getErrorMessage());
      return false;
   }

   size_t rlen = 0;
   string buf(' ', 100);
   if (!ReadFile(hPipe, buf.data(), (DWORD)buf.size(), (DWORD*)&rlen, nullptr)) {
      LOG("Cannot read child queue, exiting ({})", getErrorMessage());
      return false;
   }
   if (rlen >= buf.size()) {
      LOG("Child queue reading overflow, exiting");
      return false;
   }
   buf.resize(rlen);
   LOG("Read from child queue: {} {}", rlen, buf);

   if (buf == _T("stopped")) {
      LOG(_T("Session closed message received"));
   }

   CloseHandle(hPipe);

   return true;
}

string getErrorMessage()
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
