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
import Read from './pages/Read'
import Share from './pages/Share'
import Games from './pages/Games'
import Match from './pages/Match'
import Monster from './pages/Monster'
import Learn from './pages/Learn'
import Listen from './pages/Listen'
import Spell from './pages/Spell'
import UnitTest from './pages/UnitTest'
import Mastery from './pages/Mastery'
import Forms from './pages/Forms'
import Days from './pages/Days'
import Hall from './pages/Hall'
import Extra from './pages/Extra'
import FlowDay from './pages/FlowDay'
import AudioFailToast from './components/AudioFailToast'
import ProfileGate from './components/ProfileGate'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <ProfileGate>
        <BrowserRouter basename="/">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/hall" element={<Hall />} />
          <Route path="/extra" element={<Extra />} />
          <Route path="/days" element={<Days />} />
          <Route path="/flow/:no" element={<FlowDay />} />
          <Route path="/d/:id" element={<Dictation />} />
          <Route path="/learn/:id" element={<Learn />} />
          <Route path="/listen/:id" element={<Listen />} />
          <Route path="/spell/:id" element={<Spell />} />
          <Route path="/map" element={<Mastery />} />
          <Route path="/forms/:kind" element={<Forms />} />
          <Route path="/review" element={<Review />} />
          <Route path="/exam/:id" element={<Exam />} />
          <Route path="/test/:uid" element={<UnitTest />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/words" element={<Words />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/print/:id" element={<PrintSheet />} />
          <Route path="/paper/:id" element={<Paper />} />
          <Route path="/parent" element={<Parent />} />
          <Route path="/train" element={<Train />} />
          <Route path="/games" element={<Games />} />
          <Route path="/games/match" element={<Match />} />
          <Route path="/games/monster" element={<Monster />} />
          <Route path="/translate/:id" element={<Translate />} />
          <Route path="/read/:id" element={<Read />} />
          <Route path="/s/:id" element={<Share />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <AudioFailToast />
        </BrowserRouter>
      </ProfileGate>
    </StoreProvider>
  </React.StrictMode>
)
