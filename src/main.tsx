import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import { installDiagnosticCapture } from './core/diagnostics'
import { installIncidentContext } from './core/diagnosticExport'

const stopDiagnostics = installDiagnosticCapture();
const stopIncidentContext = installIncidentContext();
import.meta.hot?.dispose(stopDiagnostics);
import.meta.hot?.dispose(stopIncidentContext);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
