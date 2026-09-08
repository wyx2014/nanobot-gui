import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import { installDiagnosticCapture } from './core/diagnostics'

const stopDiagnostics = installDiagnosticCapture();
import.meta.hot?.dispose(stopDiagnostics);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
