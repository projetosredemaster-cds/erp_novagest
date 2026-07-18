import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';

export default function AppShell() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar />
      <main className="ml-56 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}