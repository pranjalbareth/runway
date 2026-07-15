import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import Catalog from './pages/Catalog'
import Dashboard from './pages/Dashboard'
import AuditLog from './pages/AuditLog'
import Plugins from './pages/Plugins'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/catalog" replace />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="plugins" element={<Plugins />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
