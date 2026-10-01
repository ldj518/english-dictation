import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { StoreProvider } from './lib/store'
import './styles.css'

import Home from './pages/Home'
import Dictation from './pages/Dictation'
import Review from './pages/Review'
import Exam from './pages/Exam'
import Stats from './pages/Stats'
import Words from './pages/Words'
import Settings from './pages/Settings'
import PrintSheet from './pages/PrintSheet'
import Paper from './pages/Paper'
import Parent from './pages/Parent'
import Train from './pages/Train'
import Translate from './pages/Translate'
import Share from './pages/Share'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <BrowserRouter basename="/">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/d/:id" element={<Dictation />} />
          <Route path="/review" element={<Review />} />
          <Route path="/exam/:id" element={<Exam />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/words" element={<Words />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/print/:id" element={<PrintSheet />} />
          <Route path="/paper/:id" element={<Paper />} />
          <Route path="/parent" element={<Parent />} />
          <Route path="/train" element={<Train />} />
          <Route path="/translate/:id" element={<Translate />} />
          <Route path="/s/:id" element={<Share />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </React.StrictMode>
)
