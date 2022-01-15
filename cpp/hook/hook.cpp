
#include "pch.h"
#include "utils.h"

int _tmain(int argc, TCHAR* argv[])
{
   if (auto log = _tgetenv(_T("DEEPDEBUGGER_LOGFILE"))) {
      ENABLE_LOGGING(log, _T("hook"));
   }

   string cmdline = GetCommandLine();

   cConfig config(_T(""), argc, argv);

   if (!config.send()) {
      return -1;
   };

   LOG("Success");
   return 0;
}
