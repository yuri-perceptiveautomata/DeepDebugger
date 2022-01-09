// utils.cpp : Defines the functions for the static library.
//

#include "pch.h"
#include "framework.h"

#include "utils.h"

std::tuple<string, string, string> getQueueNames()
{
   auto queue_name = _tgetenv(_T("DEEPDEBUGGER_LAUNCHER_QUEUE"));
   if (!queue_name) {
      LOG(_T("Cannot retrieve queue name, exiting"));
      return {};
   }
   LOG("Queue name: {}", queue_name);

   auto parent_session_id = _tgetenv(_T("DEEPDEBUGGER_SESSION_ID"));
   if (!parent_session_id) {
      LOG(_T("Cannot retrieve parent session ID, exiting"));
      return {};
   }
   LOG(_T("Parent session ID retrieved: {}"), parent_session_id);

   string hook_queue = join(queue_name, _T("."), parent_session_id);
   return { queue_name, hook_queue, parent_session_id };
}

void makeConfig(json& cfg, const string& session_type, const string& cmdline, const string& parent_session_id, const string& hook_queue)
{
   LOG("Setting session type to {}", session_type);
   cfg["type"] = session_type;

   LOG("Setting session command line to {}", cmdline);
   cfg["cmdline"] = cmdline;

   LOG("Setting session working dir");
   cfg["cwd"] = fs::current_path().string();

   std::list<json> env;
   for (TCHAR** s = _tenviron; *s; s++) {
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

   LOG("Setting session id and hook queue");
   cfg["propNameSessionId"] = parent_session_id;
   cfg["deepDbgHookPipe"] = hook_queue;
}

bool send(const string& queue_name, const json& cfg)
{
   std::string message = _T("start|") + cfg.dump();
   LOG("Debug session request: {}", message);

   HANDLE hPipe = CreateFile(queue_name.c_str(), GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
   if (hPipe == INVALID_HANDLE_VALUE) {
      LOG("Cannot open parent queue, exiting");
      return false;
   }

   LOG("Queue opened successfully");

   DWORD dwWritten = 0;
   WriteFile(hPipe, message.c_str(), (DWORD)message.length(), &dwWritten, NULL);
   CloseHandle(hPipe);

   return true;
}

bool await(const string& queue_name)
{
   DWORD pipeMode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT;
   HANDLE hPipe = CreateNamedPipe(queue_name.c_str(), PIPE_ACCESS_DUPLEX, pipeMode, 1, 1000, 1000, NMPWAIT_USE_DEFAULT_WAIT, nullptr);
   if (hPipe == INVALID_HANDLE_VALUE) {
      LOG("Cannot create child queue {}, exiting ({})", queue_name, getErrorMessage());
      return false;
   }
   LOG("Child queue created successfully: {}", queue_name);

   if (!ConnectNamedPipe(hPipe, NULL)) {
      LOG("Cannot open child queue {}, exiting ({})", queue_name, getErrorMessage());
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
