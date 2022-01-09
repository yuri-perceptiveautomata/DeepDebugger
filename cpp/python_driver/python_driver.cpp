
#include "pch.h"
#include "utils.h"

using namespace nlohmann;

int _tmain(int argc, TCHAR* argv[])
{
   ENABLE_LOGGING(_T("log.txt"), _T("python driver"));

   string_view connect_switch = _T("--connect");

   string_view python_path;
   auto python_cfg = fs::path(argv[0]).replace_filename(_T("parent.cfg"));
   LOG("python_cfg = {}", python_cfg.string());

   cFileContents fc;
   if (fs::exists(python_cfg)) {
      fc.read(python_cfg);
      if (auto home = findValue(_T("path"), fc); !home.empty()) {
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

   auto python_path_quoted = quote(python_path);

   string cmdline = GetCommandLine();
   string_view args = PathGetArgs(cmdline.data());

   if (!launch_debugger) {
      string cmd = joins(python_path_quoted, args);
      LOG("Executing {}", cmd);
      return execute(cmd);
   }

   auto [queue, hook_queue, parent_session_id] = getQueueNames();
   if (queue.empty() || hook_queue.empty() || parent_session_id.empty()) {
      LOG("Exiting because of empty queue name");
      return 1;
   }

   json cfg;
      
   auto session_type = _T("deepdbg-pythonBin");
   makeConfig(cfg, session_type, cmdline, parent_session_id, hook_queue);

   LOG("Setting session program path to {}", python_path);
   cfg["program"] = python_path;

   if (!send(queue, cfg)) {
      return 1;
   }

   if (!await(hook_queue)) {
      return 1;
   }

   LOG("Success");
   return 0;
}
