
#include "pch.h"

static bool sClientConnected;

int _tmain(int argc, TCHAR* argv[])
{
   TCHAR *log = nullptr, *posArg[2] = {nullptr, nullptr};
   for (int idx = 1, ai = 0; idx < argc; ++idx) {
      if (argv[idx] == _T("-l"sv)) {
         log = argv[++idx];
         continue;
      }
      posArg[ai++] = argv[idx];
   }
   if (log) {
      ENABLE_LOGGING(log, _T("server"));
   }

   if (!posArg[0]) {
      ERROR("No queue name provided, exiting");
      return 1;
   }

   string queue = posArg[0];
   DWORD pipeMode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT;
   const size_t queue_bufsize = 10000;

   DWORD rlen = 0;

   if (auto buf = posArg[1]) {
      const auto size = (DWORD)_tcslen(buf);
      HANDLE hPipe = CreateFile(queue.c_str(), GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
      if (hPipe == INVALID_HANDLE_VALUE) {
         ERROR("Cannot open queue {}, exiting ({})", queue, getErrorMessage());
         return 1;
      }
      auto success = WriteFile(hPipe, buf, size, &rlen, nullptr);
      CloseHandle(hPipe);
      if (!success || !rlen) {
         if (GetLastError() == ERROR_BROKEN_PIPE) {
            LOG("Client disconnected");
         }
         else {
            ERROR("WriteFile failed ({})", getErrorMessage());
         }
         return 1;
      }
      return 0;
   }

   while (true) {
      HANDLE hPipe = CreateNamedPipe(queue.c_str(), PIPE_ACCESS_DUPLEX, pipeMode, 100, queue_bufsize, queue_bufsize, NMPWAIT_USE_DEFAULT_WAIT, nullptr);
      if (hPipe == INVALID_HANDLE_VALUE) {
         ERROR("Cannot create queue {}, exiting ({})", queue, getErrorMessage());
         return 1;
      }
      LOG("Queue created successfully: {}, waiting for messages...", queue);

      if (!ConnectNamedPipe(hPipe, NULL)) {
         ERROR("Cannot connect queue {}, exiting ({})", queue, getErrorMessage());
         CloseHandle(hPipe);
      }
      else {
         static TCHAR buf[queue_bufsize];
         const auto size = std::size(buf) - sizeof(*buf);
         string data = _T("start|");
         while (true) {
            auto success = ReadFile(hPipe, buf, size, &rlen, nullptr);
            if (!success || !rlen) {
               if (GetLastError() == ERROR_BROKEN_PIPE) {
                  LOG("Client disconnected");
               }
               else {
                  ERROR("ReadFile failed ({})", getErrorMessage());
               }
               break;
            }
            buf[rlen] = 0;
            LOG("Read from queue: {} {}", rlen, buf);
            if (string_view(buf) == _T("stopped")) {
               LOG(_T("Stop message received"));
               CloseHandle(hPipe);
               return 0;
            }
            data += buf;
         }
         LOG("stdout: {}", data);
         data += _T("|end");
         printf("%s", data.c_str());
         fflush(stdout);
      }
   }
}
