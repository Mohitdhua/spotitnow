import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';

const normalizeRouteErrorMessage = (error: unknown) => {
  if (isRouteErrorResponse(error)) {
    return typeof error.data === 'string' && error.data.trim()
      ? error.data
      : error.statusText || `Route error ${error.status}`;
  }

  if (error instanceof Error) {
    if (/decode|codec|unsupported|source image could not be decoded/i.test(error.message)) {
      return `${error.message} If this keeps happening, try MP4 (H.264/AAC) for videos or re-save the image as PNG/JPEG.`;
    }
    return error.message;
  }

  return 'Something unexpected went wrong while loading this screen.';
};

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message = normalizeRouteErrorMessage(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-[28px] border-4 border-black bg-white p-8 shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-[#FEE2E2] text-slate-900">
          <AlertTriangle size={22} strokeWidth={2.6} />
        </div>
        <div className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#DC2626]">Route Error</div>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-slate-900">This screen hit a snag</h1>
        <p className="mt-4 rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3 text-sm font-semibold text-slate-700">
          {message}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-black px-4 py-3 text-sm font-black uppercase tracking-wide text-white"
          >
            <RotateCcw size={16} />
            Reload
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-900"
          >
            <Home size={16} />
            Back Home
          </Link>
        </div>
      </div>
    </div>
  );
}
