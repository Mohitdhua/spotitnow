import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ProjectBootstrap } from './components/ProjectBootstrap';
import { appRouter } from './routes';

export function AppRoot() {
  return (
    <ProjectBootstrap>
      <RouterProvider router={appRouter} />
      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          classNames: {
            toast: '!border-2 !border-black !rounded-2xl !shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]',
            title: '!font-black !uppercase !tracking-wide',
            description: '!font-semibold'
          }
        }}
      />
    </ProjectBootstrap>
  );
}
