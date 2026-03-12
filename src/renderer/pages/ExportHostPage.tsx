import { useEffect, useRef } from 'react';
import { runWebCodecsExport } from '@/lib/export/webcodecs-export';

const api = window.electronAPI;

export function ExportHostPage() {
  const runningRef = useRef(false);

  useEffect(() => {
    const unsubscribe = api.onExportJob(async (job) => {
      if (runningRef.current) {
        api.notifyExportHostError({
          jobId: job.jobId,
          error: 'The hidden export host is already processing another export job.',
        });
        return;
      }

      runningRef.current = true;

      try {
        await runWebCodecsExport(job, (progress) => {
          api.notifyExportHostProgress({ jobId: job.jobId, progress });
        });
        api.notifyExportHostDone({ jobId: job.jobId, outputPath: job.outputPath });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown export error';
        api.notifyExportHostError({ jobId: job.jobId, error: message });
      } finally {
        runningRef.current = false;
      }
    });

    api.notifyExportHostReady();
    return unsubscribe;
  }, []);

  return <div className="sr-only">Export host</div>;
}
