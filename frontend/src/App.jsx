import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from '../pages/Landing';
import AndroidLab from '../pages/AndroidLab';
import PythonIdle from '../pages/PythonIdle';
import SqlLab from '../pages/SqlLab';
import StartCoding from '../pages/StartCoding';
import X86Studio from '../pages/X86Studio';
import OctaveLab from '../pages/OctaveLab';
import LinuxTerminal from '../pages/LinuxTerminal';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/start-coding" element={<StartCoding />} />
      <Route path="/android-lab" element={<AndroidLab />} />
      <Route path="/x86-studio" element={<X86Studio />} />
      <Route path="/python-idle" element={<PythonIdle />} />
      <Route path="/sql-lab" element={<SqlLab />} />
      <Route path="/octave" element={<OctaveLab />} />
      <Route path="/linux-terminal" element={<LinuxTerminal />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
