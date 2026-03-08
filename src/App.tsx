import { useState, useEffect, useMemo, useCallback, ReactNode, FormEvent } from 'react';
import { User, ClassMember, Report, Schedule } from './types';
import {
  LogIn, LayoutDashboard, ClipboardList, Users, LogOut, MapPin,
  Camera, CheckCircle2, AlertCircle, Clock, ChevronRight,
  UserPlus, Trash2, RotateCcw, X, Search, Plus,
  Edit2, ChevronDown, Calendar, ShieldCheck, RefreshCw, ArrowRight, Settings,
  CheckCircle, AlertTriangle, Info, Eye, EyeOff, Copy, FolderOpen, Folder,
  History, Image as ImageIcon, Maximize2, Key,
  Shuffle, BookOpen, ClipboardPaste, UserX, BookOpenCheck, GraduationCap,
  Archive, Bell, BellOff, Shield, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SCHOOL_LAT, SCHOOL_LON, MAX_DISTANCE_METERS, getDistance, getCurrentWIBTime, getStatus } from './constants';
import confettiLib from 'canvas-confetti';
const confetti = (opts?: confettiLib.Options) => confettiLib(opts);

// --- IMAGE COMPRESSION UTILITY ---
/**
 * Kompres gambar menggunakan Canvas API.
 * - Resize: jika lebar/tinggi > 1280px, kecilkan secara proporsional.
 * - Quality: 0.7 (70%)
 * - Format output: image/jpeg
 * - Returns: Promise<File> yang valid untuk FormData
 */
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    // Validasi: pastikan file adalah gambar
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('File bukan gambar yang valid'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // cleanup segera setelah load

      const MAX_SIZE = 1280;
      let { width, height } = img;

      // Resize proporsional jika melebihi MAX_SIZE
      if (width > MAX_SIZE || height > MAX_SIZE) {
        if (width > height) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        } else {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Gagal membuat canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Gagal mengompres gambar'));
            return;
          }
          // Buat File dari Blob agar bisa masuk FormData dengan nama yang benar
          const compressedFile = new File(
            [blob],
            file.name.replace(/\.[^.]+$/, '') + '.jpg',
            { type: 'image/jpeg', lastModified: Date.now() }
          );
          resolve(compressedFile);
        },
        'image/jpeg',
        0.7 // quality 70%
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Gagal memuat gambar untuk kompresi'));
    };

    img.src = objectUrl;
  });
}

// --- TOAST NOTIFICATION SYSTEM ---
type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; message: string; type: ToastType; }

let _toastId = 0;
let _toastDispatch: ((t: ToastItem) => void) | null = null;

const toast = {
  success: (msg: string) => _toastDispatch?.({ id: ++_toastId, message: msg, type: 'success' }),
  error: (msg: string) => _toastDispatch?.({ id: ++_toastId, message: msg, type: 'error' }),
  info: (msg: string) => _toastDispatch?.({ id: ++_toastId, message: msg, type: 'info' }),
  warning: (msg: string) => _toastDispatch?.({ id: ++_toastId, message: msg, type: 'warning' }),
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    _toastDispatch = (t) => {
      setToasts(prev => [...prev.slice(-4), t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000);
    };
    return () => { _toastDispatch = null; };
  }, []);

  const icons: Record<ToastType, ReactNode> = {
    success: <CheckCircle size={18} className="text-emerald-600" />,
    error: <AlertCircle size={18} className="text-red-500" />,
    info: <Info size={18} className="text-blue-500" />,
    warning: <AlertTriangle size={18} className="text-amber-500" />,
  };
  const colors: Record<ToastType, string> = {
    success: 'border-emerald-200 bg-emerald-50',
    error: 'border-red-200 bg-red-50',
    info: 'border-blue-200 bg-blue-50',
    warning: 'border-amber-200 bg-amber-50',
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-300 flex flex-col gap-2 pointer-events-none sm:max-w-sm sm:w-full">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className={`flex items-start gap-3 px-4 py-3.5 rounded-2xl border shadow-xl ${colors[t.type]} pointer-events-auto w-full`}>
            <div className="shrink-0 mt-0.5">{icons[t.type]}</div>
            <p className="text-sm font-semibold text-slate-800 leading-snug flex-1 min-w-0 wrap-break-word">{t.message}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

// --- CONSTANTS ---
const MEMBER_STATUSES = {
  HADIR: 'Hadir',
  SAKIT_SURAT: 'Sakit (Dengan Surat)',
  SAKIT_TANPA: 'Sakit (Tanpa Surat)',
  TELAT: 'Telat',
  IZIN: 'Izin',
  TIDAK_PIKET: 'Tidak Piket',
  DISPEN: 'Dispen',
  ALFA: 'Alfa',
} as const;
type MemberStatus = typeof MEMBER_STATUSES[keyof typeof MEMBER_STATUSES];
const DAYS_ORDER = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
const ALL_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// --- SHARED UTILITY COMPONENTS ---
const LoadingSpinner = ({ className = '' }: { className?: string }) => (
  <div className={`flex items-center justify-center py-20 ${className}`}>
    <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

// Shared jadwal pelajaran list (used by GuestPanel and PJJadwalPelajaranView)
const JadwalPelajaranList = ({ rows }: { rows: any[] }) => {
  const byDay = DAYS_ORDER.reduce((acc: Record<string, any[]>, d) => {
    acc[d] = rows.filter((r: any) => r.hari === d).sort((a: any, b: any) => a.jam_ke - b.jam_ke);
    return acc;
  }, {});
  if (rows.length === 0) return (
    <div className="py-20 text-center bg-white rounded-3xl border border-slate-100">
      <BookOpenCheck size={40} className="text-slate-300 mx-auto mb-3" />
      <p className="text-slate-400 font-medium">Jadwal pelajaran belum tersedia.</p>
    </div>
  );
  return (
    <div className="space-y-4">
      {DAYS_ORDER.filter(d => byDay[d].length > 0).map(day => (
        <div key={day} className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
          <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
            <h4 className="font-bold text-emerald-800 text-sm uppercase tracking-widest">{day}</h4>
            <span className="text-[10px] font-bold text-emerald-500">{byDay[day].length} jam</span>
          </div>
          {byDay[day].map((r: any) => (
            <div key={r.id} className="px-6 py-3 flex items-center gap-4 border-b border-slate-50 last:border-0">
              <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center font-black text-sm shrink-0">{r.jam_ke}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900 text-sm">{r.mata_pelajaran}</p>
                {r.guru && <p className="text-xs text-slate-400">{r.guru}</p>}
              </div>
              {(r.jam_mulai || r.jam_selesai) && (
                <span className="text-xs font-bold text-slate-400 shrink-0">{r.jam_mulai}{r.jam_selesai ? `–${r.jam_selesai}` : ''}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

// --- UTILS ---
const safeFetch = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type");
  if (!res.ok) {
    if (contentType?.includes("application/json")) {
      const err = await res.json();
      throw new Error(err.message || `HTTP error! status: ${res.status}`);
    }
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  if (!contentType?.includes("application/json")) throw new Error("Server returned non-JSON response.");
  return res.json();
};

// Server-side date fetch (anti-fraud)
let _serverDateCache: { date: string; ts: number } | null = null;
const getServerDate = async (): Promise<string> => {
  if (_serverDateCache && Date.now() - _serverDateCache.ts < 60000) return _serverDateCache.date;
  try {
    const r = await safeFetch('/api/server-time');
    _serverDateCache = { date: r.date, ts: Date.now() };
    return r.date;
  } catch { return new Date().toISOString().split('T')[0]; }
};
const getTodayStr = () => new Date().toISOString().split('T')[0]; // fallback only

// --- IMAGE PREVIEW MODAL ---
const ImagePreviewModal = ({ src, onClose }: { src: string; onClose: () => void }) => (
  <AnimatePresence>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-all z-10">
        <X size={20} />
      </button>
      <motion.img
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        src={src}
        alt="Preview"
        className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </motion.div>
  </AnimatePresence>
);

// --- CUSTOM DROPDOWN ---
const CustomDropdown = ({ options, value, onChange, placeholder = "Pilih...", className = "", disabled = false }: {
  options: { id: string | number; label: string }[];
  value: string | number;
  onChange: (id: any) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find(o => o.id.toString() === value?.toString());
  return (
    <div className={`relative ${className}`}>
      <button type="button" disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium text-slate-700 hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isOpen ? 'ring-2 ring-emerald-500/20 border-emerald-500 bg-white' : ''}`}
      >
        <span className={selected ? 'text-slate-900 font-semibold' : 'text-slate-400'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-60]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-2xl border border-slate-100 z-70 max-h-24 overflow-y-auto py-1.5"
              style={{ overscrollBehavior: 'contain' }}
            >
              {options.map(opt => (
                <button key={opt.id} type="button"
                  onClick={() => { onChange(opt.id); setIsOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${opt.id.toString() === value?.toString() ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                >{opt.label}</button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- CONFIRM DIALOG ---
const ConfirmDialog = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Ya, Lanjutkan", requireText = false, expectedText = "KONFIRMASI" }: {
  isOpen: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmText?: string; requireText?: boolean; expectedText?: string;
}) => {
  const [inputText, setInputText] = useState('');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl border border-slate-100">
        <div className="flex justify-between items-start mb-6">
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={20} /></button>
        </div>
        <p className="text-slate-600 mb-8 leading-relaxed font-medium">{message}</p>
        {requireText && (
          <div className="mb-8">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-3 tracking-widest">Ketik "{expectedText}" untuk konfirmasi</label>
            <input type="text" className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all font-mono text-sm bg-slate-50" placeholder={expectedText} value={inputText} onChange={(e) => setInputText(e.target.value)} />
          </div>
        )}
        <div className="flex gap-4">
          <button onClick={onClose} className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all active:scale-[0.98]">Batal</button>
          <button onClick={() => { if (requireText && inputText !== expectedText) return; onConfirm(); onClose(); setInputText(''); }}
            disabled={requireText && inputText !== expectedText}
            className="flex-1 py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-lg shadow-red-200 active:scale-[0.98] disabled:opacity-50"
          >{confirmText}</button>
        </div>
      </motion.div>
    </div>
  );
};

// --- ABOUT MODAL ---

const StarParticle = ({ index }: { index: number }) => {
  const sizes = [8, 10, 6, 12, 7, 9, 11, 6, 8, 10, 7, 9, 12, 8, 6, 10];
  const sz = sizes[index % sizes.length];
  const leftPct = (index * 6.25) % 100;
  const topPct = ((index * 11.7) + (index % 3) * 17) % 100;
  const duration = 2.5 + (index % 4) * 0.8;
  const delay = index * 0.2;
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: `${leftPct}%`, top: `${topPct}%`, width: sz, height: sz }}
      animate={{ scale: [0.5, 1.4, 0.5], opacity: [0.2, 1, 0.2], rotate: [0, 180, 360] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full" style={{ color: `hsl(${45 + index * 8}, 100%, ${70 + (index % 3) * 10}%)` }}>
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
      </svg>
    </motion.div>
  );
};

const AboutModal = ({ onClose }: { onClose: () => void }) => {
  const [starClicks, setStarClicks] = useState(0);
  const [lwaModeActive, setLwaModeActive] = useState(false);
  const [promoLinks, setPromoLinks] = useState<any[]>([]);

  useEffect(() => {
    safeFetch('/api/promo-links').then(setPromoLinks).catch(() => { });
  }, []);

  const getPromoIcon = (type: string) => {
    const icons: Record<string, string> = {
      whatsapp: '💬',
      github_profile: '🐙',
      github_repo: '📦',
      website: '🌐',
      jurusan: '🎓',
      custom: '🔗',
    };
    return icons[type] || '🔗';
  };

  const handleStarClick = () => {
    const next = starClicks + 1;
    setStarClicks(next);
    if (next >= 3) {
      setLwaModeActive(true);
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.4 }, colors: ['#fbbf24', '#f59e0b', '#ffffff', '#fef3c7'] });
    }
  };

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-3 sm:p-5"
      style={{
        background: lwaModeActive
          ? 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(100,10,30,0.95) 0%, rgba(15,5,30,0.98) 100%)'
          : 'rgba(15, 23, 42, 0.4)',
        backdropFilter: 'blur(8px)'
      }}>

      {/* Ambient glow orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div className="absolute rounded-full"
          style={{ width: 400, height: 400, top: '-10%', left: '-10%', background: lwaModeActive ? 'radial-gradient(circle, rgba(185,28,28,0.4) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 65%)' }}
          animate={{ scale: [1, 1.25, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute rounded-full"
          style={{ width: 350, height: 350, bottom: '-5%', right: '-5%', background: 'radial-gradient(circle, rgba(120,40,200,0.35) 0%, transparent 65%)' }}
          animate={{ scale: [1.2, 0.85, 1.2], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 2 }} />
      </div>

      {/* Modal card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.88, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 220 }}
        className="relative w-full sm:max-w-sm rounded-4xl sm:rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col"
        style={{
          background: lwaModeActive
            ? 'linear-gradient(160deg, #1e0628 0%, #2a0838 45%, #160420 100%)'
            : '#ffffff',
          border: lwaModeActive ? '1px solid rgba(220,38,38,0.45)' : '1px solid rgba(226, 232, 240, 0.8)',
          maxHeight: '90dvh',
        }}>

        {/* Star particles layer */}
        <div className="absolute inset-0 pointer-events-none">
          {lwaModeActive && Array.from({ length: 24 }).map((_, i) => <StarParticle key={i} index={i} />)}
        </div>

        {/* Top banner */}
        <div className="relative shrink-0 pt-7 pb-5 px-5 text-center"
          style={{ background: lwaModeActive ? 'linear-gradient(180deg, rgba(190,30,30,0.55) 0%, transparent 100%)' : 'none' }}>
          <button onClick={onClose}
            className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{
              background: lwaModeActive ? 'rgba(220,38,38,0.3)' : '#f1f5f9',
              border: lwaModeActive ? '1px solid rgba(255,100,100,0.4)' : '1px solid #e2e8f0',
              color: lwaModeActive ? '#fca5a5' : '#64748b'
            }}>
            <X size={15} />
          </button>
          {/* Star button - triple click for LWA easter egg */}
          <motion.button
            onClick={handleStarClick}
            animate={lwaModeActive ? { y: [0, -8, 0], rotate: [0, 360], scale: [1, 1.3, 1] } : { y: [0, -4, 0], scale: [1, 1.05, 1] }}
            transition={lwaModeActive ? { duration: 2, repeat: Infinity } : { duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="text-4xl sm:text-5xl mb-2.5 select-none leading-none block mx-auto cursor-pointer"
            title={starClicks < 3 ? `Klik ${3 - starClicks}x lagi...` : 'Atsuko Kagari!'}
          >{lwaModeActive ? '⭐' : '✨'}</motion.button>
          <motion.h2
            animate={{
              textShadow: lwaModeActive
                ? ['0 0 16px rgba(251,191,36,0.6)', '0 0 32px rgba(245,158,11,0.9)', '0 0 16px rgba(251,191,36,0.6)']
                : 'none'
            }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-xl sm:text-2xl font-black tracking-wider leading-none"
            style={{ color: lwaModeActive ? '#fbbf24' : '#0f172a', fontFamily: lwaModeActive ? '"Georgia", serif' : 'inherit' }}>
            {lwaModeActive ? 'ATSUKO KAGARI' : 'KLASIK'}
          </motion.h2>
          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: lwaModeActive ? 'rgba(252,211,77,0.7)' : '#64748b' }}>
            {lwaModeActive ? '~ Little Witch Academia ~' : '~ Manajemen Kelas · TKJT 1 ~'}
          </p>
        </div>

        {/* Scrollable content — hidden scrollbar */}
        <div className="relative flex-1 px-4 pb-5 space-y-2.5 overflow-y-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

          {/* App identity card */}
          <div className="rounded-2xl p-3.5"
            style={{
              background: lwaModeActive ? 'rgba(185,28,28,0.22)' : '#f8fafc',
              border: lwaModeActive ? '1px solid rgba(220,38,38,0.3)' : '1px solid #f1f5f9'
            }}>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5" style={{ color: lwaModeActive ? '#fbbf24' : '#10b981' }}>✦ Nama Aplikasi</p>
            <p className={`font-black text-sm leading-snug ${lwaModeActive ? 'text-white' : 'text-slate-900'}`}>KlaSik — Manajemen Kelas</p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {['SMK Ananda Mitra Industri Deltamas', 'TKJT 1 (Angkatan Ke-8)'].map(badge => (
                <span key={badge} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: lwaModeActive ? 'rgba(185,28,28,0.35)' : '#ffffff',
                    border: lwaModeActive ? '1px solid rgba(220,38,38,0.35)' : '1px solid #e2e8f0',
                    color: lwaModeActive ? 'rgba(255,200,200,0.85)' : '#64748b'
                  }}>
                  {badge}
                </span>
              ))}
            </div>
          </div>

          {/* Tech stack */}
          <div className="rounded-2xl p-3.5"
            style={{
              background: lwaModeActive ? 'rgba(109,40,217,0.2)' : '#f8fafc',
              border: lwaModeActive ? '1px solid rgba(139,92,246,0.3)' : '1px solid #f1f5f9'
            }}>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] mb-2" style={{ color: lwaModeActive ? '#c4b5fd' : '#10b981' }}>✦ Teknologi</p>
            <div className="flex flex-wrap gap-1.5">
              {['React + TypeScript', 'Vite', 'Tailwind CSS', 'Express.js', 'SQLite', 'Framer Motion'].map(t => (
                <span key={t} className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                  style={{
                    background: lwaModeActive ? 'rgba(139,92,246,0.22)' : '#ffffff',
                    border: lwaModeActive ? '1px solid rgba(167,139,250,0.38)' : '1px solid #e2e8f0',
                    color: lwaModeActive ? '#ddd6fe' : '#64748b'
                  }}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Features grid */}
          <div className="rounded-2xl p-3.5"
            style={{
              background: lwaModeActive ? 'rgba(0,0,0,0.3)' : '#f8fafc',
              border: lwaModeActive ? '1px solid rgba(185,28,28,0.22)' : '1px solid #f1f5f9'
            }}>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] mb-2.5" style={{ color: lwaModeActive ? '#fbbf24' : '#10b981' }}>✦ Fitur Utama</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {[
                ['⚡', 'Absensi + Geofencing'],
                ['📸', 'Laporan + Foto'],
                ['👥', 'Manajemen Anggota'],
                ['📅', 'Jadwal Otomatis'],
                ['🎲', 'Auto-Shuffle'],
                ['📋', 'Import Jadwal'],
              ].map(([icon, text]) => (
                <div key={text} className="flex items-center gap-1.5">
                  <span className="text-sm leading-none shrink-0">{icon}</span>
                  <span className={`text-[10px] font-medium ${lwaModeActive ? 'text-white/80' : 'text-slate-600'}`}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quote */}
          <div className="rounded-2xl p-3 text-center"
            style={{
              background: lwaModeActive ? 'rgba(185,28,28,0.12)' : '#f8fafc',
              border: lwaModeActive ? '1px dashed rgba(251,191,36,0.28)' : '1px dashed #e2e8f0'
            }}>
            {!lwaModeActive && (
              <p className={`text-[10px] italic text-slate-600 `}>
                "Dibuat dengan dedikasi untuk memudahkan pengelolaan kebersihan kelas."
              </p>
            )}
            {lwaModeActive && (
              <p className={`text-[10px] italic text-white/80`}>
                "Sejarah itu penting, tapi masa depan adalah sesuatu yang kita buat sendiri dengan tangan kita!"
              </p>
            )}
            {lwaModeActive && (
              <p className="text-[9px] mt-1 font-bold" style={{ color: 'rgba(252,211,77,0.38)' }}>
                — Atsuko Kagari · Little Witch Academia
              </p>
            )}
          </div>

          {lwaModeActive && (
            <p className="text-center text-[9px] font-medium" style={{ color: 'rgba(255,255,255,0.22)' }}>
              @mynamethiris
            </p>
          )}

          {/* Promo Links */}
          {promoLinks.length > 0 && (
            <div className="rounded-2xl p-3.5"
              style={{
                background: lwaModeActive ? 'rgba(0,0,0,0.25)' : '#f8fafc',
                border: lwaModeActive ? '1px solid rgba(185,28,28,0.22)' : '1px solid #f1f5f9'
              }}>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] mb-2.5" style={{ color: lwaModeActive ? '#fbbf24' : '#10b981' }}>✦ Tautan &amp; Saluran</p>
              <div className="flex flex-col gap-1.5">
                {promoLinks.map((link: any) => (
                  <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: lwaModeActive ? 'rgba(255,255,255,0.06)' : '#ffffff',
                      border: lwaModeActive ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0',
                    }}>
                    <span className="text-sm leading-none shrink-0">{getPromoIcon(link.type)}</span>
                    <span className="text-[11px] font-bold flex-1 min-w-0 truncate" style={{ color: lwaModeActive ? 'rgba(255,255,255,0.85)' : '#334155' }}>{link.label}</span>
                    <span className="text-[9px] font-bold shrink-0" style={{ color: lwaModeActive ? 'rgba(251,191,36,0.6)' : '#94a3b8' }}>→</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};


// --- SHUFFLE MODAL ---
const ShuffleModal = ({ onClose, onDone }: { onClose: () => void; onDone: () => void }) => {
  const [numGroups, setNumGroups] = useState(5);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [loadingBlacklist, setLoadingBlacklist] = useState(true);

  useEffect(() => {
    safeFetch('/api/settings').then((s: any) => {
      try { setBlacklist(JSON.parse(s.schedule_day_blacklist || '[]')); } catch { setBlacklist([]); }
    }).catch(() => { }).finally(() => setLoadingBlacklist(false));
  }, []);

  const toggleDay = (day: string) => {
    setBlacklist(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const availableDays = DAYS_ORDER.filter(d => !blacklist.includes(d));
  const maxGroups = Math.min(10, availableDays.length);

  const handleShuffle = async () => {
    setLoading(true);
    try {
      // Save blacklist first
      await safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'schedule_day_blacklist', value: JSON.stringify(blacklist) }) });
      await safeFetch("/api/shuffle-members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ numGroups: Math.min(numGroups, maxGroups) }) });
      setDone(true);
      confetti({ particleCount: 140, spread: 90, origin: { y: 0.6 } });
      setTimeout(() => { onDone(); onClose(); }, 1800);
    } catch (err: any) {
      toast.error(err.message || "Gagal melakukan acak");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 80 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
        className="bg-white w-full sm:max-w-sm rounded-t-4xl sm:rounded-4xl shadow-2xl overflow-hidden">

        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-9 h-1 bg-slate-200 rounded-full" />
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-12 px-6 gap-4 text-center">
              <motion.div
                animate={{ scale: [1, 1.15, 1], rotate: [0, -8, 8, 0] }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center">
                <CheckCircle size={32} className="text-emerald-600" />
              </motion.div>
              <div>
                <p className="text-lg font-black text-slate-900">Berhasil Diacak! 🎉</p>
                <p className="text-sm text-slate-500 font-medium mt-1">Anggota & jadwal didistribusi ulang secara merata.</p>
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 py-5 sm:px-6 sm:py-6 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)', boxShadow: '0 4px 12px rgba(124,58,237,0.3)' }}>
                    <Shuffle size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Acak Anggota</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Distribusi otomatis merata</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={18} /></button>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-amber-800 text-xs font-medium leading-relaxed">
                  Semua data <strong>PJ, kelompok, dan jadwal lama akan dihapus</strong> dan diganti baru secara acak.
                </p>
              </div>

              {/* Day blacklist */}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Blacklist Hari (Tidak Dipakai Saat Acak)</p>
                {loadingBlacklist ? (
                  <div className="flex gap-2">{DAYS_ORDER.map(d => <div key={d} className="h-8 w-16 bg-slate-100 rounded-xl animate-pulse" />)}</div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {DAYS_ORDER.map(day => {
                      const isBlacklisted = blacklist.includes(day);
                      return (
                        <button key={day} type="button" onClick={() => toggleDay(day)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border-2 ${isBlacklisted ? 'bg-red-100 border-red-400 text-red-700 line-through' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-emerald-400'}`}>
                          {day}
                        </button>
                      );
                    })}
                  </div>
                )}
                {availableDays.length === 0 && (
                  <p className="text-xs text-red-500 font-bold mt-1.5">⚠️ Semua hari diblacklist! Minimal satu hari harus aktif.</p>
                )}
                {blacklist.length > 0 && availableDays.length > 0 && (
                  <p className="text-[10px] text-emerald-600 font-medium mt-1.5">✓ Hari aktif: {availableDays.join(', ')}</p>
                )}
              </div>

              {/* Group count stepper */}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mb-3">Jumlah Kelompok</p>
                <div className="flex items-center justify-center gap-4">
                  <button type="button" onClick={() => setNumGroups(n => Math.max(2, n - 1))}
                    className="w-12 h-12 bg-slate-100 hover:bg-slate-200 active:scale-90 rounded-2xl font-black text-2xl text-slate-700 flex items-center justify-center transition-all">
                    −
                  </button>
                  <div className="text-center w-16">
                    <motion.span
                      key={numGroups}
                      initial={{ scale: 1.3, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }}
                      className="text-5xl font-black text-slate-900 block tabular-nums">{Math.min(numGroups, maxGroups)}</motion.span>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">kelompok</p>
                  </div>
                  <button type="button" onClick={() => setNumGroups(n => Math.min(maxGroups, n + 1))}
                    className="w-12 h-12 bg-slate-100 hover:bg-slate-200 active:scale-90 rounded-2xl font-black text-2xl text-slate-700 flex items-center justify-center transition-all">
                    +
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 font-medium text-center mt-2">Selisih maks 1 anggota per kelompok · Maks {maxGroups} hari aktif</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-1">
                <button onClick={onClose}
                  className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-2xl hover:bg-slate-200 active:scale-[0.97] transition-all">
                  Batal
                </button>
                <button onClick={handleShuffle} disabled={loading || numGroups < 2 || availableDays.length === 0}
                  className="flex-1 py-3.5 font-bold text-sm rounded-2xl text-white flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}>
                  {loading
                    ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <><Shuffle size={16} />Acak Sekarang</>}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

// --- SCHEDULE COPY/PASTE MODAL ---
const ScheduleCopyPaste = ({ schedules, users, onClose, onImported }: { schedules: any[]; users: any[]; onClose: () => void; onImported: () => void }) => {
  const [mode, setMode] = useState<"copy" | "paste">("copy");
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newAccounts, setNewAccounts] = useState<{ name: string; code: string }[]>([]);

  const buildCopyText = () => {
    const lines: string[] = [];
    for (const day of DAYS_ORDER) {
      const sched = schedules.find(s => s.day === day);
      if (!sched) continue;
      lines.push(day);
      const pjUser = users.find((u: any) => u.role === "pj" && u.group_name === sched.group_name);
      lines.push(`• ${pjUser ? pjUser.name : sched.group_name} (PJ)`);
      lines.push("");
    }
    return lines.join("\n").trim();
  };
  const copyText = buildCopyText();

  const handleCopy = () => {
    navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImport = async () => {
    if (!pasteText.trim()) return;
    setImporting(true);
    try {
      const res = await safeFetch("/api/schedules/import-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText })
      });
      onImported();
      if (res.newAccounts && res.newAccounts.length > 0) {
        setNewAccounts(res.newAccounts);
      } else {
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message || "Gagal mengimpor jadwal");
    } finally {
      setImporting(false);
    }
  };

  // Show new accounts result screen
  if (newAccounts.length > 0) {
    return (
      <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          className="bg-white w-full sm:max-w-md rounded-t-4xl sm:rounded-4xl shadow-2xl overflow-hidden">
          <div className="flex justify-center pt-3 sm:hidden"><div className="w-9 h-1 bg-slate-200 rounded-full" /></div>
          <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                <CheckCircle size={20} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-black text-emerald-900">Jadwal Berhasil Diimpor!</p>
                <p className="text-xs text-emerald-700 font-medium">{newAccounts.length} akun PJ baru otomatis dibuat</p>
              </div>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {newAccounts.map(a => (
                <div key={a.code} className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{a.name}</p>
                    <p className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">Kode Login PJ</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-black text-blue-700 tracking-[0.15em]">{a.code}</span>
                    <button onClick={() => navigator.clipboard.writeText(a.code)}
                      className="p-1.5 text-blue-400 hover:text-blue-700 hover:bg-blue-100 rounded-lg transition-all">
                      <Copy size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 font-medium text-center">Simpan kode-kode ini. PJ menggunakannya untuk login.</p>
            <button onClick={onClose}
              className="w-full py-3.5 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 active:scale-[0.97] transition-all">
              Selesai
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
        className="bg-white w-full sm:max-w-lg rounded-t-4xl sm:rounded-4xl shadow-2xl overflow-hidden"
        style={{ maxHeight: '92dvh' }}>

        <div className="flex justify-center pt-3 sm:hidden"><div className="w-9 h-1 bg-slate-200 rounded-full" /></div>
        <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(92dvh - 1.5rem)', scrollbarWidth: 'none' }}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900">Salin / Tempel Jadwal</h3>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={18} /></button>
          </div>

          {/* Tab switcher */}
          <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
            {[
              { id: 'copy' as const, label: 'Salin Jadwal', icon: <Copy size={14} /> },
              { id: 'paste' as const, label: 'Tempel & Import', icon: <ClipboardPaste size={14} /> },
            ].map(tab => (
              <button key={tab.id} onClick={() => setMode(tab.id)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5
                  ${mode === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {mode === "copy" ? (
              <motion.div key="copy" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }} className="space-y-3">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 font-mono text-xs whitespace-pre-wrap text-slate-700 max-h-40 overflow-y-auto leading-relaxed"
                  style={{ scrollbarWidth: 'thin' }}>
                  {copyText || <span className="text-slate-400 italic">Belum ada jadwal tersimpan.</span>}
                </div>
                <button onClick={handleCopy} disabled={!copyText}
                  className="w-full py-3.5 bg-slate-900 text-white font-bold text-sm rounded-2xl hover:bg-slate-800 active:scale-[0.97] transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                  {copied ? <><CheckCircle size={16} />Tersalin ke Clipboard!</> : <><Copy size={16} />Salin Jadwal</>}
                </button>
              </motion.div>
            ) : (
              <motion.div key="paste" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }} className="space-y-3">
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <Info size={13} className="text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-700 font-medium leading-relaxed">
                    Akun PJ & data anggota akan <strong>otomatis dibuat</strong> dari teks. Format: nama hari → <code>• Nama (PJ)</code> → <code>• Anggota</code>
                  </p>
                </div>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                  className="w-full h-28 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono text-slate-700 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all resize-none leading-relaxed"
                  placeholder="Senin&#10;• Ahmad (PJ)&#10;• Budi&#10;&#10;Selasa&#10;• Citra (PJ)" />
                <button onClick={handleImport} disabled={!pasteText.trim() || importing}
                  className="w-full py-3.5 font-bold text-sm rounded-2xl text-white flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-40"
                  style={{ background: importing ? '#6b7280' : 'linear-gradient(135deg, #059669, #10b981)', boxShadow: importing ? 'none' : '0 4px 14px rgba(5,150,105,0.3)' }}>
                  {importing
                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Mengimpor...</>
                    : <><ClipboardPaste size={16} />Import & Buat Akun Otomatis</>}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

// --- ABSENT MANAGEMENT MODAL ---
const AbsentManagementModal = ({ members, onClose }: { members: any[]; onClose: () => void }) => {
  const [selectedDay, setSelectedDay] = useState(DAYS_ORDER[0]);
  const [search, setSearch] = useState("");
  const [absentList, setAbsentList] = useState<{ id: number; name: string; reason: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const allMembers = members.filter(m => !m.is_pj_group);
  const filtered = allMembers.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) && !absentList.find(a => a.id === m.id));

  const addAbsent = (m: any) => {
    setAbsentList(prev => [...prev, { id: m.id, name: m.name, reason: "Alfa" }]);
    setSearch("");
    setShowSearch(false);
  };
  const removeAbsent = (id: number) => setAbsentList(prev => prev.filter(a => a.id !== id));
  const updateReason = (id: number, reason: string) => setAbsentList(prev => prev.map(a => a.id === id ? { ...a, reason } : a));

  const copyAbsentText = () => {
    const lines = [`Daftar Ketidakhadiran - ${selectedDay}`, ""];
    absentList.forEach(a => lines.push(`• ${a.name} — ${a.reason}`));
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Daftar disalin ke clipboard!");
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[2.5rem] w-full max-w-lg p-8 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center"><UserX size={20} /></div>
            <h3 className="text-xl font-bold text-slate-900">Anggota Tidak Masuk</h3>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={20} /></button>
        </div>
        <div className="flex gap-2 mb-6 flex-wrap">
          {DAYS_ORDER.map(d => (
            <button key={d} onClick={() => { setSelectedDay(d); setAbsentList([]); }}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${selectedDay === d ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {d}
            </button>
          ))}
        </div>
        <div className="relative mb-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus-within:ring-4 focus-within:ring-red-500/10 focus-within:border-red-400 transition-all">
            <Search size={18} className="text-slate-400 shrink-0" />
            <input type="text" placeholder="Cari nama anggota untuk ditambahkan..." className="flex-1 bg-transparent outline-none text-sm font-medium"
              value={search} onChange={e => { setSearch(e.target.value); setShowSearch(true); }} onFocus={() => setShowSearch(true)} />
          </div>
          {showSearch && search.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 z-30 max-h-48 overflow-y-auto py-2">
              {filtered.length === 0 && <p className="px-4 py-3 text-sm text-slate-400 font-medium italic">Tidak ditemukan</p>}
              {filtered.map(m => (
                <button key={m.id} onClick={() => addAbsent(m)} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">{m.name}</button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3 mb-6">
          {absentList.length === 0 ? (
            <div className="py-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <UserX size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400 font-medium italic">Cari dan tambahkan anggota yang tidak masuk</p>
            </div>
          ) : (
            absentList.map(a => (
              <div key={a.id} className="flex flex-col gap-2 p-4 bg-red-50 rounded-2xl border border-red-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-red-100 rounded-xl flex items-center justify-center text-red-600 font-bold text-sm shrink-0">{a.name.charAt(0)}</div>
                  <span className="text-sm font-bold text-red-900 flex-1">{a.name}</span>
                  <button onClick={() => removeAbsent(a.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-100 rounded-xl transition-all"><X size={16} /></button>
                </div>
                <CustomDropdown
                  options={Object.values(MEMBER_STATUSES).filter(s => s !== MEMBER_STATUSES.HADIR).map(s => ({ id: s, label: s }))}
                  value={a.reason}
                  onChange={val => updateReason(a.id, val as string)}
                />
              </div>
            ))
          )}
        </div>
        {absentList.length > 0 && (
          <button onClick={copyAbsentText}
            className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all flex items-center justify-center gap-3">
            <Copy size={18} />Salin Daftar ({absentList.length} orang)
          </button>
        )}
      </motion.div>
    </div>
  );
};

// --- SETUP PAGE ---
const SetupPage = ({ onSetup }: { onSetup: (code: string) => void }) => {
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const data = await safeFetch('/api/setup-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (data.success) setGeneratedCode(data.code);
    } catch (err: any) {
      toast.error(err.message || 'Gagal membuat akun admin');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-50" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-50" />
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative">
        <div className="glass-card p-10">
          <div className="text-center mb-10">
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="w-20 h-20 bg-emerald-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-200">
              <Key size={40} />
            </motion.div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Setup Awal</h1>
            <p className="text-slate-500 mt-2 font-medium">Generate kode akun admin untuk memulai</p>
          </div>
          {!generatedCode ? (
            <div className="space-y-6">
              <div className="p-6 bg-amber-50 border border-amber-200 rounded-3xl">
                <p className="text-amber-800 font-semibold text-sm text-center">⚠️ Belum ada akun admin. Klik tombol di bawah untuk membuat kode akses admin pertama.</p>
              </div>
              <button onClick={handleGenerate} disabled={loading} className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-xl shadow-slate-200 disabled:opacity-50 flex items-center justify-center gap-3 group">
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Key size={18} />Generate Kode Admin</>}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-3xl text-center space-y-4">
                <p className="text-emerald-700 font-bold text-sm uppercase tracking-widest">Kode Akun Admin Anda</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-3xl font-mono font-bold text-slate-900 tracking-[0.3em]">{generatedCode}</span>
                  <button onClick={handleCopy} className="p-2 bg-white rounded-xl border border-emerald-200 hover:bg-emerald-50 transition-all text-emerald-600">
                    {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                  </button>
                </div>
                <p className="text-emerald-600 text-xs font-medium">Simpan kode ini dengan aman. Anda akan membutuhkannya untuk login.</p>
              </div>
              <button onClick={() => onSetup(generatedCode)} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl transition-all shadow-xl shadow-emerald-200 flex items-center justify-center gap-3">
                Lanjut ke Login <ArrowRight size={18} />
              </button>
            </div>
          )}
        </div>
        <p className="text-center mt-8 text-slate-400 text-sm font-medium">@mynamethiris</p>
      </motion.div>
    </div>
  );
};

// --- LOGIN PAGE ---
const LoginPage = ({ onLogin, onGuest }: { onLogin: (user: User) => void; onGuest: () => void }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data = await safeFetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_code: code.toUpperCase().trim() }),
      });
      if (data.success) onLogin(data.user);
      else setError(data.message);
    } catch (err: any) {
      setError(err.message || 'Gagal menghubungkan ke server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-50" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-50" />
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative">
        <div className="glass-card p-10">
          <div className="text-center mb-10">
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="w-20 h-20 bg-emerald-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-200">
              <ShieldCheck size={40} />
            </motion.div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Manajemen Kelas</h1>
            <p className="text-slate-500 mt-2 font-medium">Masukkan kode akun Anda</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Kode Akun</label>
              <div className="relative">
                <input
                  type={showCode ? 'text' : 'password'}
                  required
                  className="input-field pl-11 pr-11 font-mono tracking-widest uppercase"
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <button type="button" onClick={() => setShowCode(!showCode)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {showCode ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && (
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-semibold flex items-center gap-3 border border-red-100">
                <AlertCircle size={18} />{error}
              </motion.div>
            )}
            <button type="submit" disabled={loading}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-xl shadow-slate-200 disabled:opacity-50 flex items-center justify-center gap-3 group">
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Masuk Sekarang<ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" /></>}
            </button>
          </form>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <button onClick={onGuest}
              className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 text-sm">
              <Eye size={16} />Masuk sebagai Guest
            </button>
          </div>
        </div>
        <p className="text-center mt-8 text-slate-400 text-sm font-medium">@mynamethiris</p>
      </motion.div>
    </div>
  );
};

// --- GUEST PANEL ---
const GuestPanel = ({ onBack }: { onBack: () => void }) => {
  const [activeTab, setActiveTab] = useState<'jadwal_pelajaran' | 'jadwal_piket'>('jadwal_pelajaran');
  const [jadwalPelajaran, setJadwalPelajaran] = useState<any[]>([]);
  const [jadwalPiket, setJadwalPiket] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [jp, s, m, u] = await Promise.all([
          safeFetch('/api/jadwal-pelajaran'),
          safeFetch('/api/schedules'),
          safeFetch('/api/members'),
          safeFetch('/api/users'),
        ]);
        setJadwalPelajaran(jp);
        setSchedules(s);
        setMembers(m);
        setUsers(u);
      } catch { }
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 sm:px-6 py-4 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-700 text-white rounded-xl flex items-center justify-center shadow-lg">
              <Eye size={18} />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-base">Mode Guest</h1>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Akses Terbatas</p>
            </div>
          </div>
          <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-all">
            <LogOut size={15} />Keluar
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Tab */}
        <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 gap-1 shadow-sm">
          {[
            { id: 'jadwal_pelajaran', label: 'Jadwal Pelajaran', icon: BookOpenCheck },
            { id: 'jadwal_piket', label: 'Jadwal Piket', icon: Users },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <tab.icon size={16} />{tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : activeTab === 'jadwal_pelajaran' ? (
          <JadwalPelajaranList rows={jadwalPelajaran} />
        ) : (
          <div className="space-y-4">
            {schedules.length === 0 ? (
              <div className="py-20 text-center bg-white rounded-3xl border border-slate-100">
                <Users size={40} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">Jadwal piket belum tersedia.</p>
              </div>
            ) : schedules.map((sched: any) => {
              const pjUser = users.find((u: any) => u.role === 'pj' && u.group_name === sched.group_name);
              const groupMembers = members.filter((m: any) => pjUser && m.pj_id === pjUser.id);
              return (
                <div key={sched.id} className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                  <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                    <h3 className="font-bold text-blue-800 text-sm uppercase tracking-widest">{sched.day}</h3>
                    <span className="text-xs font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-full">{sched.group_name}</span>
                  </div>
                  <div className="px-6 py-4 space-y-2">
                    {pjUser && (
                      <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-2xl border border-blue-100">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-sm shrink-0">{pjUser.name.charAt(0)}</div>
                        <div>
                          <p className="font-bold text-blue-900 text-sm">{pjUser.name}</p>
                          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">PJ</p>
                        </div>
                      </div>
                    )}
                    {groupMembers.filter((m: any) => m.name !== pjUser?.name).map((m: any) => (
                      <div key={m.id} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="w-7 h-7 bg-slate-200 text-slate-600 rounded-lg flex items-center justify-center font-bold text-xs shrink-0">{m.name.charAt(0)}</div>
                        <p className="font-medium text-slate-800 text-sm">{m.name}</p>
                      </div>
                    ))}
                    {groupMembers.length === 0 && !pjUser && (
                      <p className="text-xs text-slate-400 italic text-center py-2">Belum ada anggota</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};


// --- PJ JADWAL PELAJARAN (Read Only) ---
const PJJadwalPelajaranView = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { safeFetch('/api/jadwal-pelajaran').then(setRows).catch(() => { }).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingSpinner />;
  return <JadwalPelajaranList rows={rows} />;
};

// --- TIPS MODAL ---
const TipsModal = ({ type, onClose }: { type: 'absen' | 'laporan'; onClose: () => void }) => {
  const content = type === 'absen' ? {
    title: 'Tips Cara Absen',
    icon: <MapPin size={24} className="text-blue-600" />,
    color: 'blue',
    steps: [
      { icon: '📍', title: 'Pastikan Lokasi Aktif', desc: 'Aktifkan GPS/lokasi di HP kamu dan aktifkan akurasi lokasi pada browser. Absen hanya bisa dilakukan dalam jarak maksimal 100m dari sekolah.' },
      { icon: '📷', title: 'Ambil Foto Kehadiran', desc: 'Tekan "Ambil Foto Kehadiran", pastikan foto terlihat jelas.' },
      { icon: '⏰', title: 'Absen Tepat Waktu', desc: 'Absen sebelum batas waktu yang ditentukan admin. Waktu absen tidak boleh lebih dari 06.20 WIB, jika lebih maka PJ dianggap terlambat.' },
      { icon: '✅', title: 'Konfirmasi Kehadiran', desc: 'Setelah foto dipilih dan lokasi terdeteksi, tekan tombol "Konfirmasi Kehadiran".' },
    ]
  } : {
    title: 'Tips Cara Melapor',
    icon: <ClipboardList size={24} className="text-amber-600" />,
    color: 'amber',
    steps: [
      { icon: '🧹', title: 'Setelah Piket Selesai', desc: 'Pastikan kelas sudah bersih sebelum mengambil foto laporan.' },
      { icon: '📷', title: 'Foto Hasil Kebersihan', desc: 'Ambil foto kelas yang sudah dibersihkan. Pastikan foto menunjukkan kondisi kelas dengan jelas.' },
      { icon: '👥', title: 'Isi Status Anggota', desc: 'Pilih status hadir/tidak hadir untuk setiap anggota kelompokmu. Jika ada yang sakit/izin, pilih keterangan yang sesuai.' },
      { icon: '📝', title: 'Tandai Anggota Kelas', desc: 'Jika ada anggota kelas yang tidak masuk sekolah hari ini, cari namanya di kolom pencarian.' },
      { icon: '📤', title: 'Kirim Laporan', desc: 'Tekan "Kirim Laporan" untuk mengirim. Pastikan sudah absen kehadiran terlebih dahulu.' },
    ]
  };

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
  };

  return (
    <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 60 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
        className="bg-white w-full sm:max-w-md rounded-t-4xl sm:rounded-4xl shadow-2xl overflow-hidden"
        style={{ maxHeight: '90dvh' }}>
        <div className="flex justify-center pt-3 sm:hidden"><div className="w-9 h-1 bg-slate-200 rounded-full" /></div>
        <div className="px-5 py-5 sm:px-6 sm:py-6 overflow-y-auto" style={{ maxHeight: 'calc(90dvh - 2rem)' }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${type === 'absen' ? 'bg-blue-50' : 'bg-amber-50'}`}>
                {content.icon}
              </div>
              <h3 className="text-lg font-black text-slate-900">{content.title}</h3>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={18} /></button>
          </div>
          <div className="space-y-3">
            {content.steps.map((step, i) => (
              <div key={i} className={`flex gap-3 p-4 rounded-2xl border ${type === 'absen' ? 'bg-blue-50/50 border-blue-100' : 'bg-amber-50/50 border-amber-100'}`}>
                <span className="text-xl shrink-0 mt-0.5">{step.icon}</span>
                <div>
                  <p className={`text-sm font-bold mb-1 ${type === 'absen' ? 'text-blue-900' : 'text-amber-900'}`}>{step.title}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <button onClick={onClose} className={`w-full mt-5 py-3.5 font-bold text-sm rounded-2xl text-white transition-all ${type === 'absen' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
            Mengerti!
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// --- RANDOM GROUP NAME WIDGET ---
// Removed RandomGroupNameWidget
// --- PJ DASHBOARD ---
const PJDashboard = ({ user }: { user: User }) => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState<{ lat: number; lon: number; accuracy?: number; provider?: string } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [cleaningPhoto, setCleaningPhoto] = useState<File | null>(null);
  const [allMembers, setAllMembers] = useState<ClassMember[]>([]);
  const [memberStatuses, setMemberStatuses] = useState<Record<number, { status: MemberStatus; reason?: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [nextDuty, setNextDuty] = useState<Schedule | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [isAssignedToday, setIsAssignedToday] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedAbsentSchool, setSelectedAbsentSchool] = useState<{ member: ClassMember; reason: MemberStatus }[]>([]);
  const [activeView, setActiveView] = useState<'dashboard' | 'history' | 'schedule' | 'jadwal_pelajaran'>('dashboard');
  const [history, setHistory] = useState<Report[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editPhotoType, setEditPhotoType] = useState<'cleaning' | 'checkin'>('cleaning');
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);

  // Buat dan bersihkan Object URL untuk editPhoto agar tidak memory leak / blank
  useEffect(() => {
    if (!editPhoto) { setEditPhotoUrl(null); return; }
    const url = URL.createObjectURL(editPhoto);
    setEditPhotoUrl(url);
    return () => URL.revokeObjectURL(url); // cleanup saat file berubah atau komponen unmount
  }, [editPhoto]);
  const [editAbsents, setEditAbsents] = useState<{ member: ClassMember; reason: MemberStatus }[]>([]);
  const [editAbsentSearch, setEditAbsentSearch] = useState('');
  const [editAbsentShowSugg, setEditAbsentShowSugg] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [showAbsentMgmt, setShowAbsentMgmt] = useState(false);
  const [showTips, setShowTips] = useState<'absen' | 'laporan' | null>(null);
  // Substitusi: data kandidat & substitusi aktif milik saya
  const [subCandidates, setSubCandidates] = useState<any>(null); // { myDay, myNextDate, candidates[] }
  const [activeSub, setActiveSub] = useState<any>(null);         // substitusi pending/accepted saya sbg requester
  const [subForMe, setSubForMe] = useState<any>(null);           // substitusi di mana saya jadi pengganti
  const [showSubForm, setShowSubForm] = useState(false);
  const [subSubmitting, setSubSubmitting] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [subTab, setSubTab] = useState<'pj' | 'anggota'>('pj');
  const [showSubConfirm, setShowSubConfirm] = useState(false);
  const [pjSelfStatus, setPjSelfStatus] = useState<MemberStatus>(MEMBER_STATUSES.HADIR);
  const [emergencyModeUntil, setEmergencyModeUntil] = useState<number | null>(() => {
    const saved = localStorage.getItem('emergency_mode_until');
    return saved ? parseInt(saved) : null;
  });

  const isEmergencyActive = useMemo(() => {
    // Check server-side bypass (admin-activated with optional expiry)
    if (settings.bypass_time === 'true') {
      const expiresAt = parseInt(settings.bypass_expires_at || '0');
      if (expiresAt === 0 || Date.now() <= expiresAt) return true;
    }
    // Check local emergency mode (PJ-activated)
    if (!emergencyModeUntil) return false;
    if (Date.now() > emergencyModeUntil) {
      localStorage.removeItem('emergency_mode_until');
      return false;
    }
    return true;
  }, [emergencyModeUntil, settings]);

  // Cleanup effect for emergency mode
  useEffect(() => {
    if (emergencyModeUntil) {
      const remaining = emergencyModeUntil - Date.now();
      if (remaining > 0) {
        const timer = setTimeout(() => setEmergencyModeUntil(null), remaining);
        return () => clearTimeout(timer);
      } else {
        setEmergencyModeUntil(null);
        localStorage.removeItem('emergency_mode_until');
      }
    }
  }, [emergencyModeUntil]);

  const activateEmergencyMode = () => {
    const durationMin = parseInt(settings.bypass_duration_minutes || '15');
    const until = Date.now() + durationMin * 60 * 1000;
    setEmergencyModeUntil(until);
    localStorage.setItem('emergency_mode_until', until.toString());
    toast.success(`Mode Tanpa Batasan Aktif (${durationMin} Menit)`);
  };

  const isPassCheckinLimit = useMemo(() => {
    if (isEmergencyActive) return false;
    const limit = settings.checkin_time_limit || settings.report_time_limit || '07:00';
    const [limitH, limitM] = limit.split(':').map(Number);
    const now = new Date();
    return now.getHours() > limitH || (now.getHours() === limitH && now.getMinutes() > limitM);
  }, [settings, isEmergencyActive]);

  const isPastCleaningLimit = useMemo(() => {
    if (isEmergencyActive) return false;
    const limit = settings.cleaning_time_limit || '08:00';
    const [limitH, limitM] = limit.split(':').map(Number);
    const now = new Date();
    return now.getHours() > limitH || (now.getHours() === limitH && now.getMinutes() > limitM);
  }, [settings, isEmergencyActive]);

  // Backward compat alias
  const isPastTimeLimit = isPassCheckinLimit;

  const canEditReport = useCallback((report: Report) => {
    if (!report.submitted_at) return false;
    const limitMin = parseInt(settings.edit_time_limit_minutes || '15');
    const submittedAt = new Date((report.submitted_at.includes('Z') ? report.submitted_at : report.submitted_at + 'Z'));
    return (Date.now() - submittedAt.getTime()) / 60000 <= limitMin;
  }, [settings]);

  // Ticker for real-time countdown
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (isEmergencyActive) {
      const interval = setInterval(() => setTick(t => t + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [isEmergencyActive]);

  useEffect(() => {
    fetchStatus();
    fetchMembers();
    fetchSettings();
    fetchSubs();
    fetchHistory();
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocation({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
      setDistance(getDistance(pos.coords.latitude, pos.coords.longitude, SCHOOL_LAT, SCHOOL_LON));
    }, (err) => console.error("Geolocation error:", err), { enableHighAccuracy: true, timeout: 10000 });

    // Poll settings every 30s so PJ gets server bypass updates in real-time
    const settingsPoller = setInterval(fetchSettings, 30000);
    return () => clearInterval(settingsPoller);
  }, [user.id]);

  const fetchSubs = async () => {
    try {
      const [subs, cands] = await Promise.all([
        safeFetch(`/api/substitutions?pj_id=${user.id}`),
        safeFetch(`/api/substitutions/candidates/${user.id}`).catch(() => null),
      ]);
      setActiveSub(subs.find((s: any) => s.requester_pj_id === user.id && ['pending', 'accepted'].includes(s.status)) || null);
      setSubForMe(subs.find((s: any) => s.substitute_pj_id === user.id && ['pending', 'accepted'].includes(s.status)) || null);
      if (cands) setSubCandidates(cands);
    } catch { }
  };

  const fetchStatus = async () => {
    try {
      const data = await safeFetch(`/api/status/${user.id}`);
      setStatus(data);
    } catch { } finally { setLoading(false); }
  };

  const fetchSettings = async () => {
    try { setSettings(await safeFetch('/api/settings')); } catch { }
  };

  const fetchHistory = async () => {
    try { setHistory(await safeFetch(`/api/reports/history/${user.id}`)); } catch { }
  };

  const fetchMembers = async () => {
    try {
      const data = await safeFetch('/api/members');
      setAllMembers(data);
      const initial: Record<number, any> = {};
      data.filter((m: any) => m.pj_id === user.id).forEach((m: any) => { initial[m.id] = { status: MEMBER_STATUSES.HADIR }; });
      setMemberStatuses(initial);
      const schedData: Schedule[] = await safeFetch('/api/schedules');
      setSchedules(schedData);
      if (user.group_name) {
        const today = ALL_DAYS[new Date().getDay()];
        setIsAssignedToday(schedData.some(s => s.group_name === user.group_name && s.day === today));
        const tomorrowDay = ALL_DAYS[(new Date().getDay() + 1) % 7];
        const duty = schedData.find(s => s.group_name === user.group_name && s.day === tomorrowDay);
        if (duty) setNextDuty(duty);
      }
    } catch (err) { console.error(err); }
  };

  const handleAttendance = async () => {
    if (!photo) return;
    const isInsideSchool = distance !== null && distance <= MAX_DISTANCE_METERS;
    if (!isInsideSchool && !isEmergencyActive) {
      toast.error(`Jarak terlalu jauh (${Math.round(distance!)}m). Maksimal ${MAX_DISTANCE_METERS}m dari sekolah.`);
      return;
    }
    setSubmitting(true);
    const time = getCurrentWIBTime();
    const formData = new FormData();
    formData.append('pj_id', user.id.toString());
    try {
      const compressed = await compressImage(photo);
      formData.append('photo', compressed);
    } catch {
      formData.append('photo', photo); // fallback ke file asli jika kompresi gagal
    }
    formData.append('latitude', (location?.lat || SCHOOL_LAT).toString());
    formData.append('longitude', (location?.lon || SCHOOL_LON).toString());
    if (location?.accuracy) formData.append('accuracy', location.accuracy.toString());
    if (location?.provider) formData.append('provider', location.provider);
    formData.append('time', time);
    formData.append('status', getStatus(time));
    try {
      const data = await safeFetch('/api/attendance', { method: 'POST', body: formData });
      if (data.success) {
        if (data.pending) {
          toast.info('⏳ ' + (data.message || 'Absensi menunggu konfirmasi admin.'));
        } else {
          confetti(); toast.success('Absensi berhasil terkirim!');
        }
        fetchStatus(); fetchHistory();
      }
      else toast.error(data.message);
    } catch (err: any) { toast.error(err.message || 'Gagal mengirim absensi'); }
    finally { setSubmitting(false); }
  };

  const handleSubSubmit = async () => {
    if (!selectedCandidate || !subCandidates?.myNextDate) return;
    // Jika memilih PJ lain, tampilkan konfirmasi terlebih dahulu
    if (subTab === 'pj') {
      setShowSubConfirm(true);
      return;
    }
    // Jika memilih anggota sendiri, langsung submit
    await doSubSubmit();
  };

  const doSubSubmit = async () => {
    if (!selectedCandidate || !subCandidates?.myNextDate) return;
    setSubSubmitting(true);
    try {
      const isOwnMember = subTab === 'anggota';
      await safeFetch('/api/substitutions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_pj_id: Number(user.id),
          // substitute_pj_id diisi user.id sendiri jika anggota (agar lolos validasi server lama)
          substitute_pj_id: isOwnMember ? Number(user.id) : Number(selectedCandidate.id),
          substitute_member_name: isOwnMember ? selectedCandidate.name : null,
          original_date: subCandidates.myNextDate,
          substitute_date: isOwnMember ? null : (selectedCandidate.their_next_date || null),
          is_own_member: isOwnMember,
        }),
      });
      if (isOwnMember) {
        toast.success('Anggota berhasil dijadikan PJ sementara!');
      } else {
        toast.info('Permintaan terkirim! Menunggu konfirmasi dari ' + selectedCandidate.name + ' dan admin.');
      }
      setShowSubForm(false);
      setShowSubConfirm(false);
      setSelectedCandidate(null);
      fetchSubs();
      fetchMembers(); // refresh substituted_out status
    } catch (err: any) { toast.error(err.message); }
    setSubSubmitting(false);
  };

  const handleSubCancel = async (subId: number) => {
    try {
      await safeFetch(`/api/substitutions/${subId}`, { method: 'DELETE' });
      toast.success('Permintaan substitusi dibatalkan');
      fetchSubs();
      fetchMembers(); // refresh substituted_out status
    } catch (err: any) { toast.error(err.message); }
  };

  const handleReport = async () => {
    if (!cleaningPhoto) return;
    setSubmitting(true);
    const absentList: any[] = selectedAbsentSchool.map(({ member, reason }) => ({ member_id: member.id, name: member.name, reason }));
    const pjMembers = allMembers.filter(m => m.pj_id === user.id && m.name !== user.name);
    const absentPjMembers = pjMembers.filter(m => memberStatuses[m.id]?.status !== MEMBER_STATUSES.HADIR)
      .map(m => ({ member_id: m.id, name: m.name, reason: memberStatuses[m.id]?.status }));

    // Sertakan PJ sendiri ke laporan jika statusnya bukan Hadir
    const pjAbsentEntry = pjSelfStatus !== MEMBER_STATUSES.HADIR
      ? [{ member_id: user.id, name: user.name, reason: pjSelfStatus, is_pj: true }]
      : [];

    // Build simple description - only absent members
    const allAbsent = [...pjAbsentEntry, ...absentPjMembers, ...absentList];
    let desc = '';
    if (allAbsent.length > 0) {
      desc = allAbsent.map(m => `${m.name} - ${m.reason}`).join('\n');
    } else {
      desc = 'Semua anggota hadir';
    }

    const formData = new FormData();
    formData.append('pj_id', user.id.toString());
    try {
      const compressed = await compressImage(cleaningPhoto);
      formData.append('photo', compressed);
    } catch {
      formData.append('photo', cleaningPhoto); // fallback ke file asli
    }
    formData.append('description', desc);
    formData.append('absentMembers', JSON.stringify([...pjAbsentEntry, ...absentPjMembers, ...absentList]));
    try {
      const data = await safeFetch('/api/report', { method: 'POST', body: formData });
      if (data.success) {
        if (data.pending) {
          toast.info('⏳ ' + (data.message || 'Laporan menunggu konfirmasi admin.'));
        } else {
          confetti(); toast.success('Laporan berhasil terkirim!');
        }
        fetchStatus(); fetchHistory(); setSelectedAbsentSchool([]); setSearchTerm('');
      }
      else toast.error(data.message);
    } catch (err: any) { toast.error(err.message || 'Gagal mengirim laporan'); }
    finally { setSubmitting(false); }
  };

  const handleEditPhoto = async () => {
    if (!editingReport) return;
    setEditSubmitting(true);
    try {
      // Save photo if changed
      if (editPhoto) {
        if (!editPhoto.type.startsWith('image/')) {
          toast.error('File yang dipilih bukan gambar yang valid');
          setEditSubmitting(false);
          return;
        }
        const formData = new FormData();
        try {
          const compressed = await compressImage(editPhoto);
          formData.append('photo', compressed);
        } catch {
          formData.append('photo', editPhoto); // fallback
        }
        formData.append('photoType', editPhotoType);
        const photoResult = await safeFetch(`/api/report/${editingReport.id}/edit-photo`, { method: 'POST', body: formData });
        // Update objek report di history lokal langsung agar gambar tampil tanpa reload
        if (photoResult?.photoUrl) {
          setHistory(prev => prev.map(r => {
            if (r.id !== editingReport.id) return r;
            if (photoResult.photoType === 'checkin') return { ...r, checkin_photo: photoResult.photoUrl };
            return { ...r, cleaning_photo: photoResult.photoUrl };
          }));
        }
      }
      // Save absent members
      const absentList = editAbsents.map(({ member, reason }) => ({ member_id: member.id, name: member.name, reason }));
      const desc = absentList.length > 0 ? absentList.map(a => `${a.name} - ${a.reason}`).join('\n') : 'Semua anggota hadir';
      await safeFetch(`/api/report/${editingReport.id}/edit-absents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ absentMembers: absentList, description: desc })
      });
      await fetchHistory();
      setEditingReport(null);
      setEditPhoto(null);
      setEditAbsents([]);
      toast.success('Laporan berhasil diperbarui!');
    } catch (err: any) { toast.error(err.message || 'Gagal menyimpan perubahan'); }
    finally { setEditSubmitting(false); }
  };

  const updateMemberStatus = (id: number, status: MemberStatus) => setMemberStatuses(prev => ({ ...prev, [id]: { status } }));
  const removeSelectedAbsent = (id: number) => setSelectedAbsentSchool(prev => prev.filter(item => item.member.id !== id));

  if (loading) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-500 font-medium">Memuat Dashboard...</p>
    </div>
  );

  const pjMembers = allMembers.filter(m => m.pj_id === user.id && m.name !== user.name);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {previewImage && <ImagePreviewModal src={previewImage} onClose={() => setPreviewImage(null)} />}
      {showAbsentMgmt && <AbsentManagementModal members={allMembers} onClose={() => setShowAbsentMgmt(false)} />}
      <AnimatePresence>
        {showTips && <TipsModal type={showTips} onClose={() => setShowTips(null)} />}
      </AnimatePresence>

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Halo, {user.name} 👋</h2>
          <p className="text-slate-500 font-medium mt-1 text-sm sm:text-base">Selamat bertugas hari ini.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-card px-4 py-2.5 flex items-center gap-3">
            <div className="text-right">
              <p className="text-lg font-mono font-bold text-emerald-600 tracking-tighter">{getCurrentWIBTime()}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WIB</p>
            </div>
            <div className="w-px h-7 bg-slate-200" />
            <div className="text-left sm:block">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Status</p>
              <p className="text-xs font-bold text-emerald-600">Online</p>
            </div>
          </div>
        </div>
      </header>

      {/* Menu Navigasi — Responsive: 4-col desktop, 2-col mobile */}
      {(() => {
        const navItems = [
          { view: 'history' as const, label: 'Riwayat', icon: History, active: 'bg-slate-900 border-slate-900 text-white', iconActive: 'bg-white/10', iconInactive: 'bg-slate-50 text-slate-400' },
          { view: 'jadwal_pelajaran' as const, label: 'Pelajaran', icon: BookOpenCheck, active: 'bg-emerald-600 border-emerald-600 text-white', iconActive: 'bg-white/10', iconInactive: 'bg-emerald-50 text-emerald-400' },
          { view: 'schedule' as const, label: 'Jadwal Piket', icon: Calendar, active: 'bg-blue-600 border-blue-600 text-white', iconActive: 'bg-white/10', iconInactive: 'bg-blue-50 text-blue-400' },
        ];
        return (
          <section className="space-y-2.5 sm:space-y-0">
            {/* Desktop: 5 kolom sejajar */}
            <div className="hidden sm:grid sm:grid-cols-5 gap-3">
              {navItems.map(({ view, label, icon: Icon, active, iconActive, iconInactive }) => {
                const isActive = activeView === view;
                return (
                  <button key={view} onClick={() => setActiveView(isActive ? 'dashboard' : view)}
                    className={`flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border transition-all ${isActive ? active : 'bg-white border-slate-100 text-slate-700 hover:border-slate-200 shadow-sm'}`}>
                    <div className={`p-2 rounded-xl ${isActive ? iconActive : iconInactive}`}><Icon size={18} /></div>
                    <span className="font-bold text-xs">{label}</span>
                  </button>
                );
              })}
              <button onClick={() => setShowTips('absen')}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border transition-all bg-white border-slate-100 text-slate-700 hover:border-blue-200 hover:bg-blue-50/30 shadow-sm">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-400"><MapPin size={18} /></div>
                <span className="font-bold text-xs">Tips Absen</span>
              </button>
              <button onClick={() => setShowTips('laporan')}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border transition-all bg-white border-slate-100 text-slate-700 hover:border-amber-200 hover:bg-amber-50/30 shadow-sm">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-400"><ClipboardList size={18} /></div>
                <span className="font-bold text-xs">Tips Laporan</span>
              </button>
            </div>

            {/* Mobile: baris 1 (3 nav), baris 2 (2 tips di tengah) */}
            <div className="sm:hidden space-y-2.5">
              <div className="grid grid-cols-3 gap-2.5">
                {navItems.map(({ view, label, icon: Icon, active, iconActive, iconInactive }) => {
                  const isActive = activeView === view;
                  return (
                    <button key={view} onClick={() => setActiveView(isActive ? 'dashboard' : view)}
                      className={`flex items-center gap-2.5 p-3.5 rounded-2xl border transition-all ${isActive ? active : 'bg-white border-slate-100 text-slate-700 hover:border-slate-200 shadow-sm'}`}>
                      <div className={`p-1.5 rounded-lg shrink-0 ${isActive ? iconActive : iconInactive}`}><Icon size={16} /></div>
                      <span className="font-bold text-[11px] leading-tight">{label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={() => setShowTips('absen')}
                  className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border transition-all bg-white border-slate-100 text-slate-700 hover:border-blue-200 hover:bg-blue-50/30 shadow-sm">
                  <div className="p-1.5 rounded-lg bg-blue-50 text-blue-400 shrink-0"><MapPin size={16} /></div>
                  <span className="font-bold text-[11px]">Tips Absen</span>
                </button>
                <button onClick={() => setShowTips('laporan')}
                  className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border transition-all bg-white border-slate-100 text-slate-700 hover:border-amber-200 hover:bg-amber-50/30 shadow-sm">
                  <div className="p-1.5 rounded-lg bg-amber-50 text-amber-400 shrink-0"><ClipboardList size={16} /></div>
                  <span className="font-bold text-[11px]">Tips Laporan</span>
                </button>
              </div>
            </div>
          </section>
        );
      })()}


      {/* Alerts & Emergency Mode Status */}
      <div className="space-y-3">
        {isEmergencyActive && (() => {
          // Determine source & remaining time
          const serverExpiry = parseInt(settings.bypass_expires_at || '0');
          const localExpiry = emergencyModeUntil;
          const isServerBypass = settings.bypass_time === 'true' && (serverExpiry === 0 || Date.now() <= serverExpiry);
          const expiryMs = isServerBypass ? serverExpiry : (localExpiry || 0);
          const remaining = expiryMs > 0 ? Math.max(0, expiryMs - Date.now()) : null;
          const remMin = remaining !== null ? Math.floor(remaining / 60000) : null;
          const remSec = remaining !== null ? Math.floor((remaining % 60000) / 1000) : null;
          return (
            <div className="p-4 bg-purple-600 text-white rounded-3xl shadow-lg shadow-purple-200 flex items-center justify-between border-2 border-purple-400">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center"><Zap size={18} className="animate-pulse" /></div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest leading-none mb-1">Mode Tanpa Batasan Aktif</p>
                  <p className="text-[10px] font-bold opacity-80">
                    {isServerBypass ? 'Diaktifkan admin — Bebas kirim absen & laporan dari mana saja.' : 'Bebas kirim absen & laporan dari mana saja.'}
                  </p>
                </div>
              </div>
              {remMin !== null && (
                <div className="text-right">
                  <p className="text-lg font-mono font-black italic">
                    {remMin}:{String(remSec!).padStart(2, '0')}
                  </p>
                  <p className="text-[8px] font-black uppercase tracking-widest leading-none">menit</p>
                </div>
              )}
              {remMin === null && (
                <div className="text-right">
                  <p className="text-xs font-black opacity-70">Tanpa batas waktu</p>
                </div>
              )}
            </div>
          );
        })()}

        {!isAssignedToday && !isEmergencyActive && (
          <div className="p-5 bg-amber-50 border border-amber-200 rounded-4xl flex items-center gap-4 text-amber-800">
            <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0"><AlertTriangle size={20} /></div>
            <div className="flex-1">
              <p className="font-bold">Bukan Jadwal Anda</p>
              <p className="text-sm font-medium opacity-80">Menu absen & laporan ditutup karena bukan jadwal Anda hari ini.</p>
            </div>
          </div>
        )}
        {isPastTimeLimit && !status && (
          <div className="p-5 bg-red-50 border border-red-200 rounded-4xl flex items-center gap-4 text-red-800">
            <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center shrink-0"><Clock size={20} /></div>
            <div><p className="font-bold">Batas Waktu Terlewati</p><p className="text-sm font-medium opacity-80">Batas absen ({settings.report_time_limit} WIB) telah berakhir.</p></div>
          </div>
        )}
      </div>

      {/* View: Schedule Full Page */}
      <AnimatePresence mode="wait">
        {activeView === 'schedule' && (
          <motion.div key="schedule" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Header row */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-black text-slate-900">Jadwal  Minggu Ini</h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    {ALL_DAYS[new Date().getDay()]}, {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <button onClick={() => setActiveView('dashboard')}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
                  <X size={18} />
                </button>
              </div>

              {/* Day columns — horizontal scroll on mobile, static 5-col on desktop */}
              <div className="flex sm:grid sm:grid-cols-5 overflow-x-auto sm:overflow-x-visible border-b border-slate-100"
                style={{ scrollbarWidth: 'none' }}>
                {DAYS_ORDER.map(day => {
                  const sched = schedules.find(s => s.day === day);
                  const isToday = day === ALL_DAYS[new Date().getDay()];
                  const isMyGroup = sched?.group_name === user.group_name;
                  return (
                    <div key={day}
                      className={`shrink-0 w-32 sm:w-auto flex flex-col items-center py-5 px-2 transition-colors border-r border-slate-100 last:border-r-0
                        ${isToday ? 'bg-emerald-50' : isMyGroup ? 'bg-blue-50/50' : 'bg-white'}`}>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-1.5
                        ${isToday ? 'text-emerald-600' : isMyGroup ? 'text-blue-500' : 'text-slate-400'}`}>{day}</p>
                      {isToday && (
                        <span className="text-[8px] font-black bg-emerald-500 text-white px-1.5 py-0.5 rounded-full mb-2 leading-none">Hari Ini</span>
                      )}
                      {isMyGroup && !isToday && (
                        <span className="text-[8px] font-black bg-blue-500 text-white px-1.5 py-0.5 rounded-full mb-2 leading-none">Anda</span>
                      )}
                      <p className={`text-xs font-bold text-center leading-snug
                        ${!sched ? 'text-slate-300 italic' : isToday ? 'text-emerald-800' : isMyGroup ? 'text-blue-800' : 'text-slate-700'}`}>
                        {sched?.group_name || '—'}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Today's group callout */}
              {(() => {
                const todaySched = schedules.find(s => s.day === ALL_DAYS[new Date().getDay()]);
                return (
                  <div className="px-4 py-3.5 space-y-2">
                    {todaySched ? (
                      <div className="flex items-center gap-3 p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200">
                        <div className="w-8 h-8 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                          <CheckCircle2 size={16} className="text-white" />
                        </div>
                        <div>
                          <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Bertugas Hari Ini</p>
                          <p className="text-sm font-black text-slate-900">{todaySched.group_name}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 font-medium italic text-center py-2">Tidak ada jadwal  hari ini.</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* View: History */}
      <AnimatePresence mode="wait">
        {activeView === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="bento-card p-6 bg-white space-y-6">
              <h3 className="text-lg font-bold text-slate-900">Riwayat Laporan Anda</h3>
              {history.length === 0 ? (
                <div className="py-16 text-center">
                  <History size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-400 font-medium">Belum ada riwayat laporan.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {history.map(report => (
                    <div key={report.id} className="p-5 rounded-3xl border border-slate-100 bg-slate-50/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{report.date}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${report.status === 'Telat' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                              {report.status === 'Telat' ? 'Telat' : 'Tepat Waktu'}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">{report.checkin_time} WIB</span>
                          </div>
                        </div>
                        {!status.is_read && report.cleaning_photo && canEditReport(report) && (
                          <button onClick={() => {
                            setEditingReport(report);
                            setEditPhoto(null);
                            // Pre-populate absents from the report
                            const preAbsents: { member: ClassMember; reason: MemberStatus }[] = (report.absents || [])
                              .filter((a: any) => allMembers.find(m => m.id === a.member_id))
                              .map((a: any) => {
                                const member = allMembers.find(m => m.id === a.member_id)!;
                                return { member, reason: (a.reason as MemberStatus) || MEMBER_STATUSES.ALFA };
                              });
                            setEditAbsents(preAbsents);
                          }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold border border-blue-100 hover:bg-blue-100 transition-all">
                            <Edit2 size={12} />Edit
                          </button>
                        )}
                      </div>
                      {report.cleaning_photo && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><ImageIcon size={10} />Foto Kebersihan</p>
                          <div className="aspect-video rounded-2xl overflow-hidden cursor-pointer relative group" onClick={() => setPreviewImage(report.cleaning_photo)}>
                            <img src={report.cleaning_photo} alt="Kebersihan" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                              <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
                            </div>
                          </div>
                        </div>
                      )}
                      {report.checkin_photo && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><ImageIcon size={10} />Foto Kehadiran</p>
                          <div className="aspect-video rounded-2xl overflow-hidden cursor-pointer relative group" onClick={() => setPreviewImage(report.checkin_photo)}>
                            <img src={report.checkin_photo} alt="Kehadiran" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                              <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
                            </div>
                          </div>
                        </div>
                      )}
                      {report.absents && report.absents.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Alfa:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {report.absents.map((a, i) => <span key={i} className="px-2.5 py-1 bg-red-50 text-red-600 text-xs font-bold rounded-full border border-red-100 whitespace-nowrap">{a.name}</span>)}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Edit modal - supports photo + absent members */}
            {editingReport && (
              <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4">
                <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', damping: 24, stiffness: 280 }}
                  className="bg-white w-full sm:max-w-lg rounded-t-4xl sm:rounded-4xl shadow-2xl overflow-hidden"
                  style={{ maxHeight: '92dvh' }}>
                  <div className="flex justify-center pt-3 sm:hidden"><div className="w-9 h-1 bg-slate-200 rounded-full" /></div>
                  <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-5 overflow-y-auto" style={{ maxHeight: 'calc(92dvh - 2rem)', scrollbarWidth: 'none' }}>
                    <div className="flex justify-between items-center">
                      <h3 className="text-xl font-bold text-slate-900">Edit Laporan</h3>
                      <button onClick={() => { setEditingReport(null); setEditPhoto(null); setEditAbsents([]); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={20} /></button>
                    </div>

                    {/* --- Section: Foto --- */}
                    <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                      <p className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Camera size={12} />Ganti Foto (Opsional)</p>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => setEditPhotoType('cleaning')}
                          className={`flex-1 py-2.5 rounded-2xl text-sm font-bold transition-all border-2 ${editPhotoType === 'cleaning' ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-white border-slate-200 text-slate-500'}`}>
                          Foto Kebersihan
                        </button>
                        <button type="button" onClick={() => setEditPhotoType('checkin')}
                          className={`flex-1 py-2.5 rounded-2xl text-sm font-bold transition-all border-2 ${editPhotoType === 'checkin' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}>
                          Foto Kehadiran
                        </button>
                      </div>
                      <label className="flex flex-col items-center p-5 bg-white rounded-2xl border-2 border-dashed border-slate-200 cursor-pointer hover:border-emerald-400 transition-all">
                        <Camera size={24} className="text-slate-400 mb-2" />
                        <span className="text-sm font-bold text-slate-600">{editPhoto ? editPhoto.name : 'Pilih foto baru (kosongkan jika tidak diganti)'}</span>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file && !file.type.startsWith('image/')) {
                            toast.error('File harus berupa gambar (JPG, PNG, dll)');
                            e.target.value = '';
                            return;
                          }
                          setEditPhoto(file || null);
                        }} />
                      </label>
                      {editPhoto && editPhotoUrl && (
                        <div className="rounded-2xl overflow-hidden aspect-video">
                          <img src={editPhotoUrl} alt="Preview" className="w-full h-full object-cover"
                            onError={() => toast.error('Gagal memuat pratinjau gambar')} />
                        </div>
                      )}
                    </div>

                    {/* --- Section: Anggota Tidak Masuk --- */}
                    <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                      <p className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><UserX size={12} />Anggota Tidak Masuk</p>
                      <div className="relative">
                        <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-2xl border border-slate-200 focus-within:ring-4 focus-within:ring-emerald-500/10 focus-within:border-emerald-500 transition-all">
                          <Search size={16} className="text-slate-400" />
                          <input type="text" placeholder="Cari nama anggota..." className="flex-1 bg-transparent outline-none text-sm font-medium"
                            value={editAbsentSearch}
                            onChange={(e) => { setEditAbsentSearch(e.target.value); setEditAbsentShowSugg(true); }}
                            onFocus={() => setEditAbsentShowSugg(true)} />
                        </div>
                        <AnimatePresence>
                          {editAbsentShowSugg && editAbsentSearch.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                              className="absolute top-full left-0 right-0 mt-1 bg-white rounded-2xl shadow-2xl border border-slate-100 z-30 max-h-44 overflow-y-auto py-2">
                              {allMembers.filter(m => !m.is_pj_group && m.name.toLowerCase().includes(editAbsentSearch.toLowerCase()) && !editAbsents.find(a => a.member.id === m.id))
                                .map(m => (
                                  <button key={m.id} onClick={() => { setEditAbsents(prev => [...prev, { member: m, reason: MEMBER_STATUSES.ALFA }]); setEditAbsentSearch(''); setEditAbsentShowSugg(false); }}
                                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">{m.name}</button>
                                ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="space-y-2">
                        {editAbsents.map(({ member, reason }) => (
                          <div key={member.id} className="flex flex-col gap-2 p-3 bg-red-50 rounded-2xl border border-red-100">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center text-red-600 font-bold text-xs shrink-0">{member.name.charAt(0)}</div>
                              <span className="text-sm font-bold text-red-900 flex-1 min-w-0 truncate">{member.name}</span>
                              <button onClick={() => setEditAbsents(prev => prev.filter(a => a.member.id !== member.id))} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-100 rounded-xl transition-all shrink-0"><X size={14} /></button>
                            </div>
                            <CustomDropdown
                              options={Object.values(MEMBER_STATUSES).filter(s => s !== MEMBER_STATUSES.HADIR).map(s => ({ id: s, label: s }))}
                              value={reason}
                              onChange={val => setEditAbsents(prev => prev.map(a => a.member.id === member.id ? { ...a, reason: val as MemberStatus } : a))}
                            />
                          </div>
                        ))}
                        {editAbsents.length === 0 && <p className="text-[10px] text-slate-400 italic font-bold uppercase tracking-widest">Tidak ada — semua anggota hadir</p>}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={() => { setEditingReport(null); setEditPhoto(null); setEditAbsents([]); }} className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all">Batal</button>
                      <button onClick={handleEditPhoto} disabled={editSubmitting}
                        className="flex-1 py-3.5 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                        {editSubmitting ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Menyimpan...</> : <><CheckCircle size={16} />Simpan Perubahan</>}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        )}

        {/* View: Jadwal Pelajaran (PJ read-only) */}
        {activeView === 'jadwal_pelajaran' && (
          <motion.div key="jadwal_pelajaran" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <PJJadwalPelajaranView />
          </motion.div>
        )}

        {/* View: Dashboard */}
        {activeView === 'dashboard' && (
          <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Attendance */}
              <div className="lg:col-span-5 space-y-6">
                <section className="bento-card p-6 sm:p-8 bg-white">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><MapPin size={20} /></div>
                      <h3 className="text-base font-bold text-slate-900">Kehadiran PJ</h3>
                    </div>
                    {isPastTimeLimit && !status && <span className="px-3 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-full border border-red-100 uppercase tracking-widest">Tutup</span>}
                  </div>
                  {status ? (
                    <div className={`p-5 rounded-3xl border-2 ${status.status === 'Telat' ? 'bg-red-50/50 border-red-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${status.status === 'Telat' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
                          {status.status === 'Telat' ? <Clock size={20} /> : <CheckCircle2 size={20} />}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Status Absensi</p>
                          <p className={`text-lg font-bold ${status.status === 'Telat' ? 'text-red-900' : 'text-emerald-900'}`}>
                            {status.status === 'Telat' ? 'Hadir (Terlambat)' : 'Hadir Tepat Waktu'}
                          </p>
                          <p className="text-sm font-medium text-slate-500">Pukul {status.checkin_time} WIB</p>
                        </div>
                      </div>
                      {/* Foto lampiran absensi */}
                      {status.checkin_photo && (
                        <div className="mt-4">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><ImageIcon size={10} />Foto Kehadiran</p>
                          <div className="rounded-2xl overflow-hidden cursor-pointer relative group aspect-video" onClick={() => setPreviewImage(status.checkin_photo)}>
                            <img src={status.checkin_photo} alt="Kehadiran" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                              <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
                            </div>
                            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold rounded-full">Klik untuk perbesar</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <label className="flex flex-col items-center p-6 bg-slate-50 rounded-4xl border-2 border-dashed border-slate-200 group hover:border-emerald-500/50 transition-all cursor-pointer">
                        <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-3 group-hover:scale-110 transition-transform">
                          <Camera size={28} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
                        </div>
                        <span className="text-sm font-bold text-slate-600">{photo ? photo.name : 'Ambil Foto Kehadiran'}</span>
                        <p className="text-xs text-slate-400 mt-1">Pastikan wajah terlihat jelas</p>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                      </label>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${distance !== null && distance <= MAX_DISTANCE_METERS ? 'bg-emerald-500' : 'bg-red-500'} animate-pulse`} />
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Lokasi</span>
                        </div>
                        <span className={`text-sm font-bold ${isEmergencyActive || (distance !== null && distance <= MAX_DISTANCE_METERS) ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isEmergencyActive ? 'BYPASSED' : distance !== null ? `${Math.round(distance)}m` : 'Mencari...'}
                        </span>
                      </div>
                      <button onClick={handleAttendance} disabled={!photo || submitting || (isPastTimeLimit && !isEmergencyActive) || (!isAssignedToday && !isEmergencyActive)}
                        className="btn-primary w-full py-4 flex items-center justify-center gap-3">
                        {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
                          (!isAssignedToday && !isEmergencyActive) ? 'Absensi Terkunci' : (isPastTimeLimit && !isEmergencyActive) ? 'Absensi Ditutup' : 'Konfirmasi Kehadiran'}
                      </button>
                    </div>
                  )}
                </section>

                {nextDuty && (
                  <div className="p-5 bg-slate-900 text-white rounded-4xl shadow-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0"><Calendar size={24} className="text-emerald-400" /></div>
                    <div>
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-1">Tugas Berikutnya</p>
                      <p className="text-base font-bold leading-tight">Besok hari {nextDuty.day} Anda bertugas.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Cleaning Report */}
              <div className="lg:col-span-7">
                <section className="bento-card p-6 sm:p-8 bg-white h-full">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center"><ClipboardList size={20} /></div>
                    <h3 className="text-base font-bold text-slate-900">Laporan Kebersihan</h3>
                  </div>

                  {status?.cleaning_photo ? (
                    <div className="space-y-5">
                      <div className="p-6 bg-emerald-50/50 rounded-4xl border-2 border-emerald-100 text-center">
                        <div className="w-14 h-14 bg-emerald-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-100"><CheckCircle2 size={28} /></div>
                        <h4 className="text-lg font-bold text-emerald-900">Laporan Berhasil Terkirim</h4>
                        <p className="text-emerald-700 font-medium mt-2 text-sm">Terima kasih atas dedikasi Anda hari ini!</p>
                        {/* Read status info */}
                        <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${status?.is_read ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {status?.is_read ? <><Eye size={12} />Laporan sudah dibaca admin</> : <><EyeOff size={12} />Menunggu admin membaca</>}
                        </div>
                      </div>
                      {status.cleaning_photo && (
                        <div className="rounded-2xl overflow-hidden cursor-pointer relative group aspect-video" onClick={() => setPreviewImage(status.cleaning_photo)}>
                          <img src={status.cleaning_photo} alt="Kebersihan" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                            <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
                          </div>
                          <div className="absolute bottom-3 right-3 px-3 py-1 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold rounded-full">Klik untuk perbesar</div>
                        </div>
                      )}
                      {status.cleaning_description && status.cleaning_description !== 'Semua anggota hadir' && (
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Anggota Tidak Hadir</p>
                          <table className="w-full text-xs border-collapse">
                            <thead><tr className="bg-white">
                              <th className="px-2 py-1 text-left font-bold text-slate-400 border border-slate-200 w-8">No</th>
                              <th className="px-2 py-1 text-left font-bold text-slate-400 border border-slate-200">Nama</th>
                              <th className="px-2 py-1 text-left font-bold text-slate-400 border border-slate-200">Keterangan</th>
                              <th className="px-2 py-1 text-center font-bold text-slate-400 border border-slate-200">Frekuensi</th>
                            </tr></thead>
                            <tbody>
                              {status.cleaning_description.split('\n').filter((l: string) => l.trim()).map((line: string, idx: number) => {
                                const parts = line.split(' - ');
                                const nama = parts[0]?.trim() || line;
                                const ket = parts.slice(1).join(' - ').trim() || '-';
                                return (
                                  <tr key={idx} className={idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
                                    <td className="px-2 py-1 text-center text-slate-400 border border-slate-200">{idx + 1}</td>
                                    <td className="px-2 py-1 font-semibold text-slate-800 border border-slate-200">{nama}</td>
                                    <td className="px-2 py-1 text-slate-600 border border-slate-200">{ket}</td>
                                    <td className="px-2 py-1 text-center border border-slate-200"><span className="px-1 py-0.5 bg-red-50 text-red-600 rounded font-bold">1x</span></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {status.cleaning_description === 'Semua anggota hadir' && (
                        <div className="px-4 py-2 bg-emerald-50 rounded-xl inline-block text-emerald-700 text-xs font-bold">✓ Semua anggota hadir</div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <label className="flex flex-col items-center p-6 bg-slate-50 rounded-4xl border-2 border-dashed border-slate-200 group hover:border-emerald-500/50 transition-all cursor-pointer">
                        <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-3 group-hover:scale-110 transition-transform">
                          <Camera size={28} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
                        </div>
                        <span className="text-sm font-bold text-slate-600">{cleaningPhoto ? cleaningPhoto.name : 'Foto Hasil Kebersihan'}</span>
                        <p className="text-xs text-slate-400 mt-1">Ambil foto kelas setelah dibersihkan</p>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setCleaningPhoto(e.target.files?.[0] || null)} />
                      </label>

                      {/* Anggota  */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Users size={12} /> Anggota Anda</p>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">{1 + pjMembers.length} Orang</span>
                        </div>
                        <div className="space-y-3">

                          {/* ── Baris PJ (diri sendiri) ── */}
                          <div className={`p-4 rounded-2xl border-2 transition-all ${pjSelfStatus !== MEMBER_STATUSES.HADIR ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                            <div className="flex flex-col gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${pjSelfStatus !== MEMBER_STATUSES.HADIR ? 'bg-amber-200' : 'bg-emerald-200'}`}>
                                  <Shield size={15} className={pjSelfStatus !== MEMBER_STATUSES.HADIR ? 'text-amber-700' : 'text-emerald-700'} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-slate-900 truncate">{user.name} <span className="text-[10px] font-bold text-slate-400 ml-1">PJ</span></p>
                                  {activeSub
                                    ? <p className="text-[10px] font-bold text-amber-600">Digantikan oleh {activeSub.substitute_name} · {activeSub.original_date}</p>
                                    : subForMe
                                      ? <p className="text-[10px] font-bold text-blue-600">Menggantikan {subForMe.requester_name} · {subForMe.original_date}</p>
                                      : null}
                                </div>
                                {activeSub && activeSub.status === 'pending' && (
                                  <button onClick={() => handleSubCancel(activeSub.id)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-lg hover:bg-red-200 transition-all shrink-0">
                                    <X size={11} />Batalkan
                                  </button>
                                )}
                              </div>
                              {/* Dropdown status PJ — sama seperti anggota */}
                              <CustomDropdown
                                options={Object.values(MEMBER_STATUSES).map(s => ({ id: s, label: s }))}
                                value={pjSelfStatus}
                                onChange={(val) => {
                                  setPjSelfStatus(val as MemberStatus);
                                }}
                              />
                            </div>
                          </div>

                          {/* ── Baris anggota biasa ── */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {pjMembers.map(m => (
                              <div key={m.id} className="flex flex-col gap-2 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <span className="text-sm font-bold text-slate-900">{m.name}</span>
                                <CustomDropdown
                                  options={Object.values(MEMBER_STATUSES).map(s => ({ id: s, label: s }))}
                                  value={memberStatuses[m.id]?.status || MEMBER_STATUSES.HADIR}
                                  onChange={(val) => updateMemberStatus(m.id, val as MemberStatus)}
                                />
                              </div>
                            ))}
                            {pjMembers.length === 0 && (
                              <div className="col-span-2 py-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                <p className="text-xs text-slate-400 font-medium italic">Belum ada anggota yang ditugaskan</p>
                              </div>
                            )}
                          </div>

                        </div>
                      </div>

                      {/* Anggota Tidak Masuk */}
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><AlertCircle size={12} /> Anggota Kelas Tidak Masuk</p>
                        <div className="space-y-3">
                          <div className="relative">
                            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus-within:ring-4 focus-within:ring-emerald-500/10 focus-within:border-emerald-500 transition-all">
                              <Search size={18} className="text-slate-400" />
                              <input type="text" placeholder="Cari nama teman sekelas..." className="flex-1 bg-transparent outline-none text-sm font-medium"
                                value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setShowSuggestions(true); }}
                                onFocus={() => setShowSuggestions(true)} />
                            </div>
                            <AnimatePresence>
                              {showSuggestions && searchTerm.length > 0 && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                                  className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 z-30 max-h-32 overflow-y-auto py-2">
                                  {allMembers.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                    .filter(m => !selectedAbsentSchool.find(item => item.member.id === m.id))
                                    .filter(m => !pjMembers.find(p => p.id === m.id))
                                    .filter(m => !m.is_pj_group)
                                    .map(m => (
                                      <button key={m.id} onClick={() => { setSelectedAbsentSchool([...selectedAbsentSchool, { member: m, reason: MEMBER_STATUSES.ALFA }]); setSearchTerm(''); setShowSuggestions(false); }}
                                        className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">{m.name}</button>
                                    ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          <div className="space-y-2">
                            {selectedAbsentSchool.map(({ member, reason }) => (
                              <div key={member.id} className="flex flex-col gap-2 p-3 bg-red-50 rounded-2xl border border-red-100">
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center text-red-600 font-bold text-xs shrink-0">{member.name.charAt(0)}</div>
                                  <span className="text-sm font-bold text-red-900 flex-1 min-w-0 truncate">{member.name}</span>
                                  <button onClick={() => removeSelectedAbsent(member.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-100 rounded-xl transition-all shrink-0"><X size={14} /></button>
                                </div>
                                <CustomDropdown
                                  options={Object.values(MEMBER_STATUSES).filter(s => s !== MEMBER_STATUSES.HADIR).map(s => ({ id: s, label: s }))}
                                  value={reason}
                                  onChange={val => setSelectedAbsentSchool(prev => prev.map(item => item.member.id === member.id ? { ...item, reason: val as MemberStatus } : item))}
                                />
                              </div>
                            ))}
                            {selectedAbsentSchool.length === 0 && <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic py-1">Belum ada anggota ditambahkan</p>}
                          </div>
                        </div>
                      </div>

                      <button onClick={handleReport} disabled={!cleaningPhoto || !status || submitting || (isPastCleaningLimit && !isEmergencyActive) || (!isAssignedToday && !isEmergencyActive)}
                        className="btn-primary w-full py-4 flex items-center justify-center gap-3 text-base">
                        {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
                          (!isAssignedToday && !isEmergencyActive) ? 'Laporan Terkunci' : (isPastCleaningLimit && !isEmergencyActive) ? 'Laporan Ditutup' : <><CheckCircle2 size={20} />Kirim Laporan</>}
                      </button>
                      {!status && !isPastTimeLimit && (isAssignedToday || isEmergencyActive) && <p className="text-center text-xs text-red-500 font-bold">⚠️ Harap absen kehadiran terlebih dahulu!</p>}
                      {isPastCleaningLimit && <p className="text-center text-xs text-red-500 font-bold">⏰ Batas waktu laporan kebersihan ({settings.cleaning_time_limit || '08:00'} WIB) telah terlewati.</p>}
                    </div>
                  )}
                </section>

              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- PROMO LINKS ADMIN SECTION ---
const PROMO_LINK_TYPES = [
  { id: 'whatsapp', label: 'Saluran WhatsApp' },
  { id: 'github_profile', label: 'Akun GitHub' },
  { id: 'github_repo', label: 'Repositori GitHub' },
  { id: 'website', label: 'Website' },
  { id: 'jurusan', label: 'Website Jurusan' },
  { id: 'custom', label: 'Kustom / Lainnya' },
];
const PROMO_ICONS: Record<string, string> = {
  whatsapp: '💬', github_profile: '🐙', github_repo: '📦', website: '🌐', jurusan: '🎓', custom: '🔗',
};

const PromoLinksAdminSection = () => {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ type: 'whatsapp', label: '', url: '', sort_order: 0 });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setLinks(await safeFetch('/api/promo-links')); } catch { }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.label.trim() || !form.url.trim()) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await safeFetch(`/api/promo-links/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      } else {
        await safeFetch('/api/promo-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ type: 'whatsapp', label: '', url: '', sort_order: 0 });
      toast.success(editingId ? 'Tautan diperbarui!' : 'Tautan ditambahkan!');
      load();
    } catch (err: any) { toast.error(err.message || 'Gagal menyimpan'); }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await safeFetch(`/api/promo-links/${id}`, { method: 'DELETE' });
      toast.success('Tautan dihapus');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className="pt-8 border-t border-slate-100 mt-4">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full" />
          <h4 className="text-sm font-black text-emerald-700 uppercase tracking-[0.2em]">Tautan Promosi (Easter Egg / About)</h4>
        </div>
        <button onClick={() => { setEditingId(null); setForm({ type: 'whatsapp', label: '', url: '', sort_order: links.length }); setShowForm(!showForm); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-all">
          <Plus size={14} />Tambah Tautan
        </button>
      </div>

      <p className="text-xs text-slate-400 font-medium mb-4">Tautan ini akan tampil di bagian bawah modal Tentang/Easter Egg (ikon buku di navbar). Hanya bisa dikelola di sini oleh admin.</p>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-5 overflow-hidden">
            <div className="p-5 bg-emerald-50 rounded-3xl border border-emerald-100 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Jenis Tautan</label>
                  <CustomDropdown
                    options={PROMO_LINK_TYPES.map(t => ({ id: t.id, label: `${PROMO_ICONS[t.id]} ${t.label}` }))}
                    value={form.type}
                    onChange={(val) => setForm(f => ({ ...f, type: val }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Label Tampilan</label>
                  <input type="text" className="input-field" placeholder="Contoh: Saluran Kelas TKJT 1" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">URL</label>
                  <input type="url" className="input-field" placeholder="https://..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Urutan Tampil</label>
                  <input type="number" min="0" className="input-field" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSave} disabled={submitting || !form.label.trim() || !form.url.trim()}
                  className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-all text-sm">
                  {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambahkan'}
                </button>
                <button onClick={() => { setShowForm(false); setEditingId(null); }}
                  className="px-4 py-3 bg-white border border-slate-200 text-slate-400 rounded-2xl hover:bg-slate-50 transition-all">
                  <X size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-14 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : links.length === 0 ? (
        <div className="py-8 text-center bg-slate-50 rounded-3xl border border-slate-100">
          <p className="text-slate-400 font-medium text-sm">Belum ada tautan promosi.</p>
          <p className="text-[11px] text-slate-400 mt-1">Tautan akan muncul di modal About/Easter Egg.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((link: any) => (
            <div key={link.id} className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-100 group">
              <span className="text-lg shrink-0">{PROMO_ICONS[link.type] || '🔗'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{link.label}</p>
                <p className="text-xs text-slate-400 truncate">{link.url}</p>
              </div>
              <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                <button onClick={() => { setEditingId(link.id); setForm({ type: link.type, label: link.label, url: link.url, sort_order: link.sort_order }); setShowForm(true); }}
                  className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"><Edit2 size={14} /></button>
                <button onClick={() => handleDelete(link.id)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- PENDING APPROVALS SECTION (disabled - admin confirmation removed) ---
const PendingApprovalsSection = () => null;

// --- ADMIN DASHBOARD ---
const AdminDashboard = ({ user, onLoginAs }: { user: User; onLoginAs: (u: User) => void }) => {
  const [reports, setReports] = useState<any[]>([]);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'reports' | 'members' | 'users' | 'schedules' | 'violations' | 'settings' | 'jadwal_pelajaran'>('reports');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: string; id: number; name?: string; onConfirm?: () => void } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adminTick, setAdminTick] = useState(0);

  // Admin edit report state
  const [adminEditingReport, setAdminEditingReport] = useState<any | null>(null);
  const [adminEditPhoto, setAdminEditPhoto] = useState<File | null>(null);
  const [adminEditPhotoType, setAdminEditPhotoType] = useState<'cleaning' | 'checkin'>('cleaning');
  const [adminEditPhotoUrl, setAdminEditPhotoUrl] = useState<string | null>(null);

  // Buat dan bersihkan Object URL untuk adminEditPhoto agar tidak memory leak / blank
  useEffect(() => {
    if (!adminEditPhoto) { setAdminEditPhotoUrl(null); return; }
    const url = URL.createObjectURL(adminEditPhoto);
    setAdminEditPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [adminEditPhoto]);
  const [adminEditAbsents, setAdminEditAbsents] = useState<{ member: ClassMember; reason: MemberStatus }[]>([]);
  const [adminEditAbsentSearch, setAdminEditAbsentSearch] = useState('');
  const [adminEditShowSugg, setAdminEditShowSugg] = useState(false);
  const [adminEditSubmitting, setAdminEditSubmitting] = useState(false);

  // Folders state
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  // Forms
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', pj_id: '' });
  const [editingMember, setEditingMember] = useState<ClassMember | null>(null);

  const [showUserForm, setShowUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', group_name: '' });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState<Record<string | number, boolean>>({});

  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [newSchedule, setNewSchedule] = useState({ group_name: '', day: 'Senin' });
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [showShuffle, setShowShuffle] = useState(false);
  const [showCopyPaste, setShowCopyPaste] = useState(false);
  const [showRandomizeConfirm, setShowRandomizeConfirm] = useState(false);
  // Admin substitution: set member as PJ substitute
  const [adminSubMember, setAdminSubMember] = useState<{ member: ClassMember; pjUser: User } | null>(null);
  const [adminSubDate, setAdminSubDate] = useState('');
  const [adminSubSubmitting, setAdminSubSubmitting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  // Tick for countdown in settings
  useEffect(() => {
    const interval = setInterval(() => setAdminTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-disable bypass_time on server when expiry passes
  useEffect(() => {
    if (settings.bypass_time !== 'true') return;
    const expiresAt = parseInt(settings.bypass_expires_at || '0');
    if (expiresAt === 0) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'bypass_time', value: 'false' }) })
        .then(() => fetchData()).catch(() => { });
      return;
    }
    const timer = setTimeout(() => {
      safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'bypass_time', value: 'false' }) })
        .then(() => fetchData()).catch(() => { });
    }, remaining);
    return () => clearTimeout(timer);
  }, [settings.bypass_time, settings.bypass_expires_at]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rep, mem, usr, sch, set] = await Promise.all([
        safeFetch('/api/all-reports'), safeFetch('/api/members'), safeFetch('/api/users'),
        safeFetch('/api/schedules'), safeFetch('/api/settings')
      ]);
      setReports(rep); setMembers(mem); setUsers(usr); setSchedules(sch); setSettings(set);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
    // Fetch notifications
    try {
      const notifs = await safeFetch('/api/notifications');
      setNotifications(notifs);
      setUnreadCount(notifs.filter((n: any) => !n.is_read).length);
    } catch { }
  };

  const handleAdminEditReport = async () => {
    if (!adminEditingReport) return;
    setAdminEditSubmitting(true);
    try {
      if (adminEditPhoto) {
        const formData = new FormData();
        try {
          const compressed = await compressImage(adminEditPhoto);
          formData.append('photo', compressed);
        } catch {
          formData.append('photo', adminEditPhoto); // fallback
        }
        formData.append('photoType', adminEditPhotoType);
        const photoResult = await safeFetch(`/api/admin/report/${adminEditingReport.id}/edit-photo`, { method: 'POST', body: formData });
        // Update laporan di state lokal langsung agar gambar tampil tanpa reload
        if (photoResult?.photoUrl) {
          setReports(prev => prev.map(r => {
            if (r.id !== adminEditingReport.id) return r;
            if (photoResult.photoType === 'checkin') return { ...r, checkin_photo: photoResult.photoUrl };
            return { ...r, cleaning_photo: photoResult.photoUrl };
          }));
        }
      }
      const absentList = adminEditAbsents.map(({ member, reason }) => ({ member_id: member.id, name: member.name, reason }));
      const desc = absentList.length > 0 ? absentList.map(a => `${a.name} - ${a.reason}`).join('\n') : 'Semua anggota hadir';
      await safeFetch(`/api/admin/report/${adminEditingReport.id}/edit-absents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ absentMembers: absentList, description: desc })
      });
      await fetchData();
      setAdminEditingReport(null);
      setAdminEditPhoto(null);
      setAdminEditAbsents([]);
      toast.success('Laporan berhasil diperbarui oleh admin!');
    } catch (err: any) { toast.error(err.message || 'Gagal menyimpan perubahan'); }
    finally { setAdminEditSubmitting(false); }
  };

  const handleDelete = async (type: string, id: number) => {
    try { await safeFetch(`/api/${type}s/${id}`, { method: 'DELETE' }); fetchData(); }
    catch (err) { console.error(err); }
  };

  const handleScheduleDelete = async (id: number) => {
    try { await safeFetch(`/api/schedules/${id}`, { method: 'DELETE' }); fetchData(); }
    catch (err) { console.error(err); }
  };

  const handleRandomizeAllGroupNames = () => {
    setShowRandomizeConfirm(true);
  };

  const doRandomizeAllGroupNames = async () => {
    try {
      await safeFetch('/api/schedules/randomize-names', { method: 'POST' });
      toast.success('Semua nama kelompok berhasil diacak!');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengacak nama kelompok');
    }
  };

  const handleReact = async (id: number) => {
    try {
      await safeFetch(`/api/reports/${id}/react`, { method: 'POST' });
      fetchData();
    } catch (err: any) { toast.error(err.message); }
  };

  const confirmDelete = (type: string, id: number, name?: string) => {
    setConfirmAction({ type, id, name });
    setIsConfirmOpen(true);
  };

  const handleReset = (type: string) => {
    setConfirmAction({
      type: 'reset', id: 0, name: `SEMUA DATA ${type.toUpperCase()}`,
      onConfirm: async () => {
        try { await safeFetch(`/api/${type}/reset`, { method: 'POST' }); fetchData(); }
        catch (err) { console.error(err); }
      }
    });
    setIsConfirmOpen(true);
  };

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    try {
      // Auto-detect PJ: if member name exists in users, link them automatically
      const autoPj = users.find(u => u.name === newMember.name && u.role === 'pj');
      const payload = { ...newMember, pj_id: autoPj ? autoPj.id.toString() : newMember.pj_id };

      if (editingMember) await safeFetch(`/api/members/${editingMember.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      else await safeFetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      setNewMember({ name: '', pj_id: '' }); setEditingMember(null); setShowMemberForm(false); fetchData();
    } catch (err: any) { toast.error(err.message || 'Gagal menyimpan anggota'); }
  };

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await safeFetch(`/api/users/${editingUser.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser) });
        setEditingUser(null);
      } else {
        const data = await safeFetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newUser, role: 'pj' }) });
        setGeneratedCode(data.account_code);
      }
      setNewUser({ name: '', group_name: '' }); setShowUserForm(false); fetchData();
    } catch (err: any) { toast.error(err.message || 'Gagal menyimpan PJ'); }
  };

  const handleAddSchedule = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editingSchedule) {
        await safeFetch(`/api/schedules/${editingSchedule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSchedule) });
        setEditingSchedule(null);
      } else {
        await safeFetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSchedule) });
      }
      setNewSchedule({ group_name: '', day: 'Senin' }); setShowScheduleForm(false); fetchData();
    } catch (err: any) { toast.error(err.message || 'Gagal menyimpan jadwal'); }
  };

  const handleRegenerateCode = async (userId: number | string) => {
    try {
      const data = await safeFetch(`/api/users/${userId}/regenerate-code`, { method: 'POST' });
      setShowCode(prev => ({ ...prev, [userId]: true }));
      fetchData();
      toast.success(`Kode baru berhasil dibuat: ${data.account_code}`);
    } catch (err: any) { toast.error(err.message); }
  };

  const updateSetting = async (key: string, value: any) => {
    try {
      await safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
      fetchData();
    }
    catch { toast.error('Gagal memperbarui pengaturan'); }
  };

  const promoteToPJ = async (member: ClassMember) => {
    try {
      const data = await safeFetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: member.name, role: 'pj', member_id: member.id, group_name: 'Kelompok ' + member.name })
      });
      setGeneratedCode(data.account_code);
      await fetchData();
      setActiveTab('users');
    } catch (err: any) { toast.error(err.message || 'Gagal mempromosikan anggota.'); }
  };

  const handleAdminSubstitute = async () => {
    if (!adminSubMember || !adminSubDate) return;
    const pjId = adminSubMember.pjUser?.id;
    const memberName = adminSubMember.member?.name;
    if (!pjId) { toast.error('Data PJ tidak valid'); return; }
    if (!memberName) { toast.error('Data anggota tidak valid'); return; }
    setAdminSubSubmitting(true);
    try {
      await safeFetch('/api/substitutions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_pj_id: Number(pjId),
          // substitute_pj_id diisi pjId sendiri agar lolos validasi server lama
          substitute_pj_id: Number(pjId),
          substitute_member_name: memberName,
          original_date: adminSubDate,
          substitute_date: null,
          is_own_member: true,
        }),
      });
      toast.success(`${memberName} ditetapkan sebagai pengganti ${adminSubMember.pjUser.name} pada ${adminSubDate}`);
      setAdminSubMember(null);
      setAdminSubDate('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menetapkan pengganti');
    }
    setAdminSubSubmitting(false);
  };

  // Group reports by date/folder
  const today = getTodayStr();
  const todayReports = reports.filter(r => r.date === today);
  const archivedReports = reports.filter(r => r.date !== today);
  const archivedByDate = archivedReports.reduce((acc: Record<string, any[]>, r) => {
    if (!acc[r.date]) acc[r.date] = [];
    acc[r.date].push(r);
    return acc;
  }, {});

  // Group members by PJ - dynamic: folder name follows PJ's current name from users list
  const membersWithPj = members.filter(m => m.pj_id);
  const membersWithoutPj = members.filter(m => !m.pj_id);
  // Build map keyed by pj_id so we can look up current PJ name dynamically
  const membersByPjId = membersWithPj.reduce((acc: Record<number, { pjUser: User | undefined; members: ClassMember[] }>, m) => {
    const pjId = m.pj_id!;
    if (!acc[pjId]) {
      acc[pjId] = { pjUser: users.find(u => u.id === pjId), members: [] };
    }
    acc[pjId].members.push(m);
    return acc;
  }, {});

  const toggleFolder = (key: string) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const availableDaysForSchedule = DAYS_ORDER.filter(day => {
    if (editingSchedule && editingSchedule.day === day) return true;
    return !schedules.some(s => s.day === day);
  });

  if (loading) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-500 font-medium">Memuat Data Admin...</p>
    </div>
  );

  // Tab groups: piket tabs and general tabs
  const piketTabs = [
    { id: 'users', label: 'Akun PJ', icon: ShieldCheck },
    { id: 'schedules', label: 'Jadwal Piket', icon: Calendar },
    { id: 'reports', label: 'Laporan Piket', icon: ClipboardList },
  ];
  const generalTabs = [
    { id: 'members', label: 'Anggota', icon: Users },
    { id: 'jadwal_pelajaran', label: 'Pelajaran', icon: BookOpenCheck },
    { id: 'violations', label: 'Laporan', icon: UserX },
    { id: 'settings', label: 'Pengaturan', icon: Settings }
  ];
  const tabs = [...piketTabs, ...generalTabs];

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      {previewImage && <ImagePreviewModal src={previewImage} onClose={() => setPreviewImage(null)} />}

      {/* Admin Edit Report Modal */}
      <AnimatePresence>
        {adminEditingReport && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
            <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 60 }}
              transition={{ type: 'spring', damping: 24, stiffness: 280 }}
              className="bg-white w-full sm:max-w-lg rounded-t-4xl sm:rounded-4xl shadow-2xl overflow-hidden"
              style={{ maxHeight: '92dvh' }}>
              <div className="flex justify-center pt-3 sm:hidden"><div className="w-9 h-1 bg-slate-200 rounded-full" /></div>
              <div className="px-5 py-5 sm:px-6 sm:py-6 overflow-y-auto space-y-5" style={{ maxHeight: 'calc(92dvh - 2rem)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-2xl flex items-center justify-center"><Edit2 size={20} className="text-blue-600" /></div>
                    <div>
                      <h3 className="text-lg font-black text-slate-900">Edit Laporan (Admin)</h3>
                      <p className="text-xs text-slate-400 font-medium">{adminEditingReport.date} · {adminEditingReport.pj_name}</p>
                    </div>
                  </div>
                  <button onClick={() => { setAdminEditingReport(null); setAdminEditPhoto(null); setAdminEditAbsents([]); }}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={18} /></button>
                </div>

                {/* Photo type selector */}
                <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
                  {[{ id: 'cleaning' as const, label: 'Foto Laporan' }, { id: 'checkin' as const, label: 'Foto Absen' }].map(t => (
                    <button key={t.id} onClick={() => setAdminEditPhotoType(t.id)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${adminEditPhotoType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Photo edit */}
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Ganti Foto {adminEditPhotoType === 'checkin' ? 'Absen' : 'Laporan'}</p>
                  <label className="flex flex-col items-center justify-center gap-2 p-5 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all">
                    {adminEditPhoto ? (
                      <>
                        {adminEditPhotoUrl && (
                          <img src={adminEditPhotoUrl} alt="Preview" className="w-full max-h-40 object-cover rounded-xl"
                            onError={() => toast.error('Gagal memuat pratinjau gambar')} />
                        )}
                        <span className="text-xs font-bold text-blue-600">{adminEditPhoto.name}</span>
                      </>
                    ) : (
                      <>
                        <Camera size={24} className="text-slate-400" />
                        <span className="text-xs font-bold text-slate-500">Pilih foto baru (opsional)</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0];
                      if (file && !file.type.startsWith('image/')) {
                        toast.error('File harus berupa gambar (JPG, PNG, dll)');
                        e.target.value = '';
                        return;
                      }
                      setAdminEditPhoto(file || null);
                    }} />
                  </label>
                </div>

                {/* Absent members edit */}
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2"><Users size={11} />Anggota Tidak Masuk</p>
                  <div className="relative mb-2">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-500 transition-all">
                      <Search size={15} className="text-slate-400" />
                      <input type="text" placeholder="Cari nama anggota..." className="flex-1 bg-transparent outline-none text-sm font-medium"
                        value={adminEditAbsentSearch}
                        onChange={e => { setAdminEditAbsentSearch(e.target.value); setAdminEditShowSugg(true); }}
                        onFocus={() => setAdminEditShowSugg(true)} />
                    </div>
                    <AnimatePresence>
                      {adminEditShowSugg && adminEditAbsentSearch.length > 0 && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                          className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-2xl border border-slate-100 z-30 max-h-32 overflow-y-auto py-1.5">
                          {members.filter(m => m.name.toLowerCase().includes(adminEditAbsentSearch.toLowerCase()) && !adminEditAbsents.find(a => a.member.id === m.id))
                            .map(m => (
                              <button key={m.id} onClick={() => { setAdminEditAbsents(prev => [...prev, { member: m, reason: MEMBER_STATUSES.ALFA }]); setAdminEditAbsentSearch(''); setAdminEditShowSugg(false); }}
                                className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{m.name}</button>
                            ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="space-y-2">
                    {adminEditAbsents.map(({ member, reason }) => (
                      <div key={member.id} className="flex flex-col gap-2 p-3 bg-red-50 rounded-2xl border border-red-100">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center text-red-600 font-bold text-xs shrink-0">{member.name.charAt(0)}</div>
                          <span className="text-sm font-bold text-red-900 flex-1 truncate">{member.name}</span>
                          <button onClick={() => setAdminEditAbsents(prev => prev.filter(a => a.member.id !== member.id))}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-100 rounded-xl transition-all"><X size={13} /></button>
                        </div>
                        <CustomDropdown
                          options={Object.values(MEMBER_STATUSES).filter(s => s !== MEMBER_STATUSES.HADIR).map(s => ({ id: s, label: s }))}
                          value={reason}
                          onChange={val => setAdminEditAbsents(prev => prev.map(a => a.member.id === member.id ? { ...a, reason: val as MemberStatus } : a))}
                        />
                      </div>
                    ))}
                    {adminEditAbsents.length === 0 && <p className="text-[10px] text-slate-400 italic py-1">Semua anggota hadir (tidak ada yang tidak masuk)</p>}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setAdminEditingReport(null); setAdminEditPhoto(null); setAdminEditAbsents([]); }}
                    className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all">Batal</button>
                  <button onClick={handleAdminEditReport} disabled={adminEditSubmitting}
                    className="flex-1 py-3.5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                    {adminEditSubmitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><CheckCircle size={16} />Simpan</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {showShuffle && <ShuffleModal onClose={() => setShowShuffle(false)} onDone={fetchData} />}
      {showCopyPaste && <ScheduleCopyPaste schedules={schedules} users={users} onClose={() => setShowCopyPaste(false)} onImported={fetchData} />}
      <ConfirmDialog
        isOpen={showRandomizeConfirm}
        onClose={() => setShowRandomizeConfirm(false)}
        onConfirm={doRandomizeAllGroupNames}
        title="Acak Nama Kelompok"
        message="Semua nama kelompok akan diacak ulang secara otomatis. Nama baru akan diterapkan ke jadwal dan akun PJ yang sudah ada. Tindakan ini tidak dapat dibatalkan."
        confirmText="Ya, Acak Sekarang"
      />

      {/* Admin Substitute Member Modal */}
      {adminSubMember && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0">
                  <Shuffle size={20} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 tracking-tight">Tetapkan Pengganti PJ</h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">dari menu anggota</p>
                </div>
              </div>
              <button onClick={() => { setAdminSubMember(null); setAdminSubDate(''); }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={20} /></button>
            </div>

            <div className="space-y-4 mb-8">
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 space-y-1">
                <p className="text-xs font-bold text-amber-600 uppercase tracking-widest">Anggota Pengganti</p>
                <p className="text-base font-bold text-slate-900">{adminSubMember.member.name}</p>
                <p className="text-xs text-slate-500">menggantikan PJ: <strong>{adminSubMember.pjUser.name}</strong> ({adminSubMember.pjUser.group_name})</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Tanggal Piket yang Digantikan</label>
                <input
                  type="date"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 outline-none transition-all font-medium text-slate-800 bg-slate-50"
                  value={adminSubDate}
                  onChange={e => setAdminSubDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={() => { setAdminSubMember(null); setAdminSubDate(''); }}
                className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all active:scale-[0.98]">Batal</button>
              <button
                onClick={handleAdminSubstitute}
                disabled={!adminSubDate || adminSubSubmitting}
                className="flex-1 py-4 bg-amber-500 text-white font-bold rounded-2xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-100 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
                {adminSubSubmitting
                  ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><Shuffle size={18} />Tetapkan</>}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Generated Code Modal */}
      {generatedCode && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl">
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto"><Key size={32} className="text-emerald-600" /></div>
              <div>
                <h3 className="text-2xl font-bold text-slate-900 mb-2">Kode Akun Dibuat!</h3>
                <p className="text-slate-500 font-medium text-sm">Berikan kode ini kepada PJ. Simpan dengan aman.</p>
              </div>
              <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-200">
                <p className="text-3xl font-mono font-bold text-slate-900 tracking-[0.3em] mb-3">{generatedCode}</p>
                <button onClick={() => { navigator.clipboard.writeText(generatedCode); }}
                  className="flex items-center gap-2 mx-auto px-4 py-2 bg-white rounded-xl border border-emerald-200 text-emerald-600 font-bold text-sm hover:bg-emerald-50 transition-all">
                  <Copy size={16} />Salin Kode
                </button>
              </div>
              <button onClick={() => setGeneratedCode(null)} className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all">Tutup</button>
            </div>
          </motion.div>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center justify-between md:block">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Panel Administrasi 🛠️</h2>
            <p className="text-slate-500 font-medium mt-1 text-sm">Kelola data laporan, anggota, dan jadwal kelas.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Notification Bell */}
          <div className="relative">
            <button onClick={async () => {
              setShowNotifications(!showNotifications);
              if (!showNotifications && unreadCount > 0) {
                await safeFetch('/api/notifications/mark-read', { method: 'POST' });
                setUnreadCount(0);
                setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
              }
            }}
              className={`relative w-10 h-10 flex items-center justify-center rounded-xl transition-all ${showNotifications ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600'}`}>
              <AlertCircle size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center animate-bounce">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <AnimatePresence>
              {showNotifications && (
                <>
                  {/* Backdrop (mobile) */}
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 z-40 sm:hidden bg-slate-900/30 backdrop-blur-sm"
                    onClick={() => setShowNotifications(false)}
                  />
                  {/* Panel: bottom sheet on mobile, dropdown on desktop */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                    className="fixed sm:absolute inset-x-0 sm:inset-x-auto bottom-0 sm:bottom-auto sm:right-0 sm:top-12 sm:w-80 bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl border border-slate-100 z-50 overflow-hidden"
                    style={{ maxHeight: '70dvh' }}>
                    <div className="flex justify-center pt-2.5 sm:hidden"><div className="w-8 h-1 bg-slate-200 rounded-full" /></div>
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-900">Notifikasi PJ</p>
                      <button onClick={() => setShowNotifications(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"><X size={14} /></button>
                    </div>
                    <div className="overflow-y-auto divide-y divide-slate-50" style={{ maxHeight: 'calc(70dvh - 80px)' }}>
                      {notifications.length === 0 ? (
                        <p className="text-center text-sm text-slate-400 font-medium py-6">Tidak ada notifikasi</p>
                      ) : notifications.slice(0, 50).map((n: any) => (
                        <div key={n.id} className={`px-4 py-3 flex items-start gap-3 transition-colors group ${!n.is_read ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${n.type === 'attendance' || n.type === 'attendance_pending' ? 'bg-blue-100 text-blue-600' : n.type === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                            {n.type === 'attendance' || n.type === 'attendance_pending' ? <MapPin size={14} /> : n.type === 'rejected' ? <AlertCircle size={14} /> : <ClipboardList size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-800 leading-snug wrap-break-word">{n.message}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString('id-ID')}</p>
                          </div>
                          <button onClick={async () => { await safeFetch(`/api/notifications/${n.id}`, { method: 'DELETE' }); setNotifications(prev => prev.filter(x => x.id !== n.id)); }}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 shrink-0" title="Hapus notifikasi ini">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {notifications.length > 0 && (
                      <div className="px-4 py-2.5 border-t border-slate-100">
                        <button onClick={async () => { await safeFetch('/api/notifications/all', { method: 'DELETE' }); setNotifications([]); setUnreadCount(0); }}
                          className="w-full py-2 text-[10px] font-bold text-red-500 hover:bg-red-50 rounded-xl transition-all uppercase tracking-widest border border-dashed border-red-200 hover:border-red-300">
                          Hapus Semua Notifikasi
                        </button>
                      </div>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          {/* Tab navigation */}
          <div className="flex flex-col gap-1.5 shrink-0">
            {/* Piket group */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1.5 hidden sm:block">Piket</span>
              <div className="flex bg-blue-50 p-1 rounded-2xl overflow-x-auto scrollbar-hide gap-0.5 border border-blue-100">
                {piketTabs.map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap shrink-0 ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-600 hover:bg-blue-100'}`}>
                    <tab.icon size={15} />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* General group */}
            <div className="flex bg-slate-100 p-1 rounded-2xl overflow-x-auto scrollbar-hide gap-0.5">
              {generalTabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap shrink-0 ${activeTab === tab.id ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <tab.icon size={15} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
      </header>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bento-card bg-white min-h-[500px]">

        {/* REPORTS TAB */}
        {activeTab === 'reports' && (
          <div className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <h3 className="text-xl font-bold text-slate-900">Riwayat Laporan Piket</h3>
              <div className="flex items-center gap-3">
                <button onClick={() => handleReset('reports')} className="px-4 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 hover:bg-red-600 hover:text-white transition-all">Reset Laporan</button>
                <button onClick={fetchData} className="p-2 hover:bg-slate-50 rounded-xl text-slate-400"><RefreshCw size={20} /></button>
              </div>
            </div>

            {/* Today's reports */}
            {todayReports.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Laporan Hari Ini</span>
                </div>
                <div className="space-y-5">
                  {todayReports.map(report => <ReportCard key={report.id} report={report} onDelete={() => confirmDelete('report', report.id, report.date)} onPreview={setPreviewImage} onReact={() => handleReact(report.id)} onAdminEdit={() => { setAdminEditingReport(report); setAdminEditPhoto(null); setAdminEditPhotoType('cleaning'); setAdminEditAbsents((report.absents || []).filter((a: any) => members.find(m => m.id === a.member_id)).map((a: any) => ({ member: members.find(m => m.id === a.member_id)!, reason: a.reason as MemberStatus }))) }} />)}
                </div>
              </div>
            )}

            {/* Archived reports folder */}
            {archivedReports.length > 0 && (
              <div className="mb-3">
                <button onClick={() => toggleFolder('arsip-root')}
                  className="w-full flex items-center gap-3 p-4 bg-slate-100 hover:bg-slate-200 rounded-2xl border border-slate-200 transition-all group">
                  {openFolders.has('arsip-root') ? <FolderOpen size={18} className="text-amber-600" /> : <Folder size={18} className="text-slate-400 group-hover:text-amber-500 transition-colors" />}
                  <span className="text-sm font-bold text-slate-700">Arsip Laporan</span>
                  <span className="ml-auto text-xs font-bold text-slate-400">{archivedReports.length} laporan</span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform ${openFolders.has('arsip-root') ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {openFolders.has('arsip-root') && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="pt-4 space-y-6 pl-2 border-l-2 border-dashed border-slate-100 ml-6 mt-2">
                        {Object.keys(archivedByDate).sort((a, b) => b.localeCompare(a)).map(date => (
                          <div key={date} className="space-y-3">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-1.5 h-1.5 bg-slate-300 rounded-full" />
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{date}</span>
                            </div>
                            <div className="space-y-4">
                              {archivedByDate[date].map(report => <ReportCard key={report.id} report={report} onDelete={() => confirmDelete('report', report.id, report.date)} onPreview={setPreviewImage} onReact={() => handleReact(report.id)} onAdminEdit={() => { setAdminEditingReport(report); setAdminEditPhoto(null); setAdminEditPhotoType('cleaning'); setAdminEditAbsents((report.absents || []).filter((a: any) => members.find(m => m.id === a.member_id)).map((a: any) => ({ member: members.find(m => m.id === a.member_id)!, reason: a.reason as MemberStatus }))); }} />)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {reports.length === 0 && (
              <div className="py-20 text-center">
                <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-3xl flex items-center justify-center mx-auto mb-4"><ClipboardList size={40} /></div>
                <p className="text-slate-400 font-medium">Belum ada laporan yang masuk.</p>
              </div>
            )}
          </div>
        )}

        {/* MEMBERS TAB */}
        {activeTab === 'members' && (
          <div className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Daftar Anggota Kelas</h3>
                <p className="text-sm text-slate-500 font-medium">Total: {members.length} Anggota</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => { setEditingMember(null); setNewMember({ name: '', pj_id: '' }); setShowMemberForm(!showMemberForm); }}
                  className="btn-primary px-4 py-2.5 flex items-center gap-2 text-sm">
                  <Plus size={16} />Tambah Anggota
                </button>

                <button onClick={() => handleReset('members')} className="px-4 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 hover:bg-red-600 hover:text-white transition-all">Reset</button>
              </div>
            </div>

            <AnimatePresence>
              {showMemberForm && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-8">
                  <form onSubmit={handleAddMember} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Nama Anggota</label>
                      <input type="text" required className="input-field" placeholder="Nama Lengkap" value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} />
                    </div>
                    {users.find(u => u.name === newMember.name)?.role !== 'pj' && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Pilih PJ Kelompok</label>
                        <CustomDropdown
                          options={[{ id: '', label: 'Tanpa PJ' }, ...users.filter(u => u.role === 'pj').map(u => ({ id: u.id, label: u.name }))]}
                          value={newMember.pj_id} onChange={(val) => setNewMember({ ...newMember, pj_id: val })}
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button type="submit" className="flex-1 btn-primary py-3 text-sm">{editingMember ? 'Simpan' : 'Tambah'}</button>
                      <button type="button" onClick={() => setShowMemberForm(false)} className="px-4 py-3 bg-white text-slate-400 border border-slate-200 rounded-2xl hover:bg-slate-50"><X size={20} /></button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Members without PJ */}
            {membersWithoutPj.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Tanpa Kelompok</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {membersWithoutPj.map(member => (
                    <MemberCard key={member.id} member={member} users={users} onEdit={() => { setEditingMember(member); setNewMember({ name: member.name, pj_id: member.pj_id?.toString() || '' }); setShowMemberForm(true); }}
                      onDelete={() => confirmDelete('member', member.id, member.name)} onPromote={() => promoteToPJ(member)} />
                  ))}
                </div>
              </div>
            )}

            {/* Members grouped by PJ folder */}
            {Object.keys(membersByPjId).map(pjIdStr => {
              const { pjUser, members: pjMembers } = membersByPjId[parseInt(pjIdStr)];
              const folderLabel = pjUser?.name || 'Unknown';
              const folderKey = `member-pj-${pjIdStr}`;
              return (
                <div key={pjIdStr} className="mb-3">
                  <button onClick={() => toggleFolder(folderKey)}
                    className="w-full flex items-center gap-3 p-4 bg-blue-50/50 hover:bg-blue-100/50 rounded-2xl border border-blue-100 transition-all group mb-2">
                    {openFolders.has(folderKey) ? <FolderOpen size={18} className="text-blue-500" /> : <Folder size={18} className="text-blue-400 group-hover:text-blue-500 transition-colors" />}
                    <span className="text-sm font-bold text-slate-700">{pjUser?.group_name || `Kelompok ${folderLabel}`}</span>
                    <span className="ml-auto text-xs font-bold text-blue-400">{pjMembers.length} Anggota</span>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${openFolders.has(folderKey) ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openFolders.has(folderKey) && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="pl-4 pt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-3">
                          {pjMembers.map(member => (
                            <MemberCard key={member.id} member={member} users={users}
                              onEdit={() => { setEditingMember(member); setNewMember({ name: member.name, pj_id: member.pj_id?.toString() || '' }); setShowMemberForm(true); }}
                              onDelete={() => confirmDelete('member', member.id, member.name)}
                              onPromote={() => promoteToPJ(member)}
                              onSubstitute={pjUser ? () => { setAdminSubMember({ member, pjUser }); setAdminSubDate(''); } : undefined} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold text-slate-900">Daftar Akun</h3>
              <div className="flex items-center gap-3">
                <button onClick={() => handleReset('users')} className="px-4 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 hover:bg-red-600 hover:text-white transition-all">Reset</button>
              </div>
            </div>

            {/* Admin Card */}
            <div className="mb-8 p-6 rounded-3xl border border-slate-200 bg-slate-50/50">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-lg"><ShieldCheck size={24} /></div>
                  <div>
                    <h4 className="font-bold text-slate-900">{user.name}</h4>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Admin</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200">
                    <span className="font-mono text-sm font-bold text-slate-600">{showCode['admin'] ? (users.find(u => u.role === 'admin')?.account_code || '••••••••') : '••••••••'}</span>
                    <button onClick={() => setShowCode(p => ({ ...p, admin: !p['admin'] }))} className="text-slate-400 hover:text-slate-600">
                      {showCode['admin'] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button onClick={() => handleRegenerateCode(users.find(u => u.role === 'admin')?.id || 0)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-all">
                    <RefreshCw size={14} />Generate Ulang Kode
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {users.filter(u => u.role === 'pj').map(pj => (
                <div key={pj.id} className="p-6 rounded-3xl border border-slate-100 bg-slate-50/50 space-y-4 hover:border-blue-200 transition-all group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100"><ShieldCheck size={22} /></div>
                      <div>
                        <h4 className="font-bold text-slate-900">{pj.name}</h4>
                        <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">penanggung jawab</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                      <button onClick={() => {
                        onLoginAs(pj);
                        toast.success(`Login sebagai ${pj.name}`);
                      }}
                        title="Login sebagai PJ ini"
                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-blue-100">
                        <LogIn size={14} />Masuk sebagai PJ
                      </button>
                      <button onClick={() => confirmDelete('user', pj.id, pj.name)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2 flex-1 px-3 py-2 bg-white rounded-xl border border-slate-100">
                      <span className="font-mono text-sm font-bold text-slate-600 flex-1">
                        {showCode[pj.id] ? (pj.account_code || '------') : '••••••'}
                      </span>
                      <button onClick={() => setShowCode(p => ({ ...p, [pj.id]: !p[pj.id] }))} className="text-slate-400 hover:text-slate-600">
                        {showCode[pj.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <button onClick={() => handleRegenerateCode(pj.id)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition-all whitespace-nowrap">
                      <RefreshCw size={12} />Generate Ulang
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {users.filter(u => u.role === 'pj').length === 0 && !showUserForm && (
              <div className="py-20 text-center">
                <ShieldCheck size={40} className="text-slate-300 mx-auto mb-4" />
                <p className="text-slate-400 font-medium mb-4">Belum ada PJ yang terdaftar.</p>
              </div>
            )}
          </div>
        )}

        {/* SCHEDULES TAB */}
        {activeTab === 'schedules' && (
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Jadwal Kelompok Mingguan</h3>
                <p className="text-sm text-slate-500 font-medium mt-1">Satu PJ per hari, Senin–Jumat</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleRandomizeAllGroupNames}
                  className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-600 border border-amber-100 hover:bg-amber-100 rounded-2xl text-sm font-bold transition-all">
                  <RefreshCw size={16} />Acak Nama Kelompok
                </button>
                <button onClick={() => setShowCopyPaste(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-2xl text-sm font-bold transition-all">
                  <Copy size={16} /><span className="hidden sm:inline">Salin/Tempel</span><span className="sm:hidden">Jadwal</span>
                </button>
                {availableDaysForSchedule.length > 0 && (
                  <button onClick={() => { setEditingSchedule(null); setNewSchedule({ group_name: '', day: availableDaysForSchedule[0] }); setShowScheduleForm(!showScheduleForm); }}
                    className="btn-primary px-4 py-2.5 flex items-center gap-2 text-sm">
                    <Plus size={16} />Tambah Jadwal
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {showScheduleForm && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-8">
                  <form onSubmit={handleAddSchedule} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Hari</label>
                      <CustomDropdown
                        options={availableDaysForSchedule.map(d => ({ id: d, label: d }))}
                        value={newSchedule.day} onChange={(val) => setNewSchedule({ ...newSchedule, day: val })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Kelompok PJ</label>
                      <CustomDropdown
                        options={[{ id: '', label: 'Pilih Kelompok...' }, ...Array.from(new Set(users.filter(u => u.role === 'pj').map(u => u.group_name))).filter((g): g is string => !!g).map(g => ({ id: g, label: g }))]}
                        value={newSchedule.group_name} onChange={(val) => setNewSchedule({ ...newSchedule, group_name: val })}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={!newSchedule.group_name} className="flex-1 btn-primary py-3 text-sm disabled:opacity-50">Simpan</button>
                      <button type="button" onClick={() => { setShowScheduleForm(false); setEditingSchedule(null); }} className="px-4 py-3 bg-white text-slate-400 border border-slate-200 rounded-2xl hover:bg-slate-50"><X size={20} /></button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Random Group Name Widget Removed */}


            {/* Visual schedule grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {DAYS_ORDER.map(day => {
                const sched = schedules.find(s => s.day === day);
                const isToday = day === ALL_DAYS[new Date().getDay()];
                return (
                  <div key={day} className={`p-5 rounded-3xl border-2 transition-all ${isToday ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-slate-50/50'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className={`text-xs font-bold uppercase tracking-widest ${isToday ? 'text-emerald-600' : 'text-slate-400'}`}>{day}</p>
                        {isToday && <span className="text-[10px] font-bold text-emerald-500 bg-emerald-100 px-2 py-0.5 rounded-full mt-1 inline-block">Hari Ini</span>}
                      </div>
                      {sched && (
                        <button onClick={() => { setEditingSchedule(sched); setNewSchedule({ group_name: sched.group_name, day: sched.day }); setShowScheduleForm(true); }}
                          className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"><Edit2 size={14} /></button>
                      )}
                    </div>
                    {sched ? (
                      <div className="space-y-3">
                        <div className={`px-3 py-2 rounded-xl text-sm font-bold ${isToday ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-700 border border-slate-100'}`}>
                          {sched.group_name}
                        </div>
                        <button onClick={() => { setConfirmAction({ type: 'schedule', id: sched.id, name: `${day}: ${sched.group_name}`, onConfirm: () => handleScheduleDelete(sched.id) }); setIsConfirmOpen(true); }}
                          className="w-full py-2 text-[10px] font-bold text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all uppercase tracking-widest border border-dashed border-slate-200 hover:border-red-200">
                          Hapus Jadwal
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingSchedule(null); setNewSchedule({ group_name: '', day }); setShowScheduleForm(true); }}
                        className="w-full py-4 text-xs font-bold text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all border border-dashed border-slate-200 hover:border-emerald-300 flex items-center justify-center gap-2">
                        <Plus size={14} />Tambahkan PJ
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIOLATIONS TAB */}
        {activeTab === 'jadwal_pelajaran' && (
          <JadwalPelajaranTab />
        )}

        {activeTab === 'violations' && (
          <ViolationsTab />
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="p-6 sm:p-8 space-y-6 flex flex-col">
            <h3 className="text-xl font-bold text-slate-900">Pengaturan Sistem</h3>

            <div className="flex flex-wrap gap-6">
              {/* Checkin time limit */}
              <div className="flex-1 min-w-[300px] p-6 bg-slate-50 rounded-3xl border border-slate-100 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shrink-0"><MapPin size={20} /></div>
                  <div>
                    <h4 className="font-bold text-slate-900">Deadline Absensi Kehadiran</h4>
                    <p className="text-xs text-slate-500 font-medium">PJ tidak bisa absen setelah jam ini.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-auto">
                  <input type="time" className="input-field max-w-[150px]" value={settings.checkin_time_limit || '07:00'} onChange={(e) => updateSetting('checkin_time_limit', e.target.value)} />
                  <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">WIB</span>
                </div>
              </div>

              {/* Cleaning report time limit */}
              <div className="flex-1 min-w-[300px] p-6 bg-slate-50 rounded-3xl border border-slate-100 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center shrink-0"><ClipboardList size={20} /></div>
                  <div>
                    <h4 className="font-bold text-slate-900">Deadline Laporan Kebersihan</h4>
                    <p className="text-xs text-slate-500 font-medium">PJ tidak bisa kirim laporan setelah jam ini.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-auto">
                  <input type="time" className="input-field max-w-[150px]" value={settings.cleaning_time_limit || '17:00'} onChange={(e) => updateSetting('cleaning_time_limit', e.target.value)} />
                  <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">WIB</span>
                </div>
              </div>

              {/* Edit time limit */}
              <div className="flex-1 min-w-[300px] p-6 bg-slate-50 rounded-3xl border border-slate-100 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center shrink-0"><Edit2 size={20} /></div>
                  <div>
                    <h4 className="font-bold text-slate-900">Batas Edit Laporan</h4>
                    <p className="text-xs text-slate-500 font-medium">PJ dapat edit foto & anggota tidak masuk dalam waktu ini.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-auto">
                  <input type="number" min="1" max="60" className="input-field max-w-[100px]" value={settings.edit_time_limit_minutes || '60'} onChange={(e) => updateSetting('edit_time_limit_minutes', e.target.value)} />
                  <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">Menit</span>
                </div>
              </div>

              {/* Recompress Images */}
              <div className="flex-1 min-w-[300px] p-6 bg-slate-50 rounded-3xl border border-slate-100 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-teal-100 text-teal-600 rounded-xl flex items-center justify-center shrink-0"><ImageIcon size={20} /></div>
                  <div>
                    <h4 className="font-bold text-slate-900">Kompresi Ulang Foto</h4>
                    <p className="text-xs text-slate-500 font-medium">Kompres ulang semua foto absen & laporan yang ada agar lebih ringan.</p>
                  </div>
                </div>
                <button onClick={async () => {
                  try {
                    await safeFetch('/api/admin/recompress-images', { method: 'POST' });
                    toast.success('Kompresi ulang dimulai di background. Foto akan lebih ringan!');
                  } catch (err: any) { toast.error(err.message); }
                }} className="px-5 py-3 bg-teal-600 text-white font-bold text-sm rounded-2xl hover:bg-teal-700 transition-all flex items-center gap-2 mt-auto w-full justify-center">
                  <ImageIcon size={16} />Kompresi Ulang Semua Foto
                </button>
              </div>


              {/* Weekly Archiver */}
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center"><Archive size={20} /></div>
                  <div>
                    <h4 className="font-bold text-slate-900">Arsip Mingguan</h4>
                    <p className="text-xs text-slate-500 font-medium">Arsipkan laporan & foto minggu lalu. Foto dihapus, data tersimpan.</p>
                  </div>
                </div>
                <button onClick={async () => {
                  try {
                    const r = await safeFetch('/api/archive/weekly', { method: 'POST' });
                    if (r.skipped) toast.info(r.message);
                    else toast.success(`Berhasil arsip ${r.archivedReports} laporan (${r.weekStart} s/d ${r.weekEnd})`);
                  } catch (err: any) { toast.error(err.message); }
                }} className="px-5 py-3 bg-indigo-600 text-white font-bold text-sm rounded-2xl hover:bg-indigo-700 transition-all flex items-center gap-2 max-w-xs">
                  <Archive size={16} />Jalankan Arsip Minggu Lalu
                </button>
              </div>
            </div>

            <div className="pt-8 border-t border-slate-100 mt-4">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                <h4 className="text-sm font-black text-amber-600 uppercase tracking-[0.2em]">Zona Testing</h4>
              </div>

              {/* Mode Tanpa Batasan (Emergency Mode) */}
              <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${settings.bypass_time === 'true' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}><Zap size={20} /></div>
                    <div>
                      <h4 className="font-bold text-slate-900">Mode Tanpa Batasan</h4>
                      <p className="text-xs text-slate-500 font-medium">PJ dapat absen & lapor tanpa batasan waktu, lokasi, dan jadwal. Auto-nonaktif setelah durasi habis.</p>
                    </div>
                  </div>
                  <button onClick={() => {
                    const isActive = settings.bypass_time === 'true';
                    if (!isActive) {
                      const durationMin = parseInt(settings.bypass_duration_minutes || '15');
                      const expiresAt = Date.now() + durationMin * 60 * 1000;
                      updateSetting('bypass_time', 'true');
                      updateSetting('bypass_expires_at', expiresAt.toString());
                    } else {
                      updateSetting('bypass_time', 'false');
                      updateSetting('bypass_expires_at', '0');
                    }
                  }}
                    className={`w-14 h-8 rounded-full transition-all relative shrink-0 ${settings.bypass_time === 'true' ? 'bg-purple-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-sm ${settings.bypass_time === 'true' ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-amber-100/50">
                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-700 mb-1">Durasi Mode Aktif</p>
                    <p className="text-[10px] text-slate-400 font-medium">Otomatis nonaktif setelah waktu habis.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number" min="1" max="1440"
                      className="input-field max-w-[80px] text-center font-bold border-amber-100 focus:border-amber-500"
                      value={settings.bypass_duration_minutes || '15'}
                      onChange={(e) => updateSetting('bypass_duration_minutes', e.target.value)}
                    />
                    <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">Menit</span>
                  </div>
                </div>

                {settings.bypass_time === 'true' && (() => {
                  const expiresAt = parseInt(settings.bypass_expires_at || '0');
                  const remaining = expiresAt > 0 ? Math.max(0, expiresAt - Date.now()) : 0;
                  const remMin = Math.floor(remaining / 60000);
                  const remSec = Math.floor((remaining % 60000) / 1000);
                  const isExpired = expiresAt > 0 && Date.now() > expiresAt;
                  return (
                    <div className={`p-3 text-[10px] font-bold rounded-xl border flex items-center justify-between gap-3 ${isExpired ? 'bg-slate-50 text-slate-500 border-slate-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                      <div className="flex items-center gap-2">
                        <Zap size={14} className={isExpired ? '' : 'animate-pulse'} />
                        {isExpired ? 'Mode berakhir — menonaktifkan...' : 'MODE TANPA BATASAN AKTIF — PJ bebas absen & lapor dari mana saja.'}
                      </div>
                      {!isExpired && expiresAt > 0 && (
                        <span className="font-mono text-sm font-black shrink-0 text-purple-800">
                          {remMin}:{String(remSec).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            <PromoLinksAdminSection />

            <PendingApprovalsSection />
          </div>
        )}
      </motion.div>

      <ConfirmDialog isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => {
          if (confirmAction) {
            if (confirmAction.onConfirm) confirmAction.onConfirm();
            else handleDelete(confirmAction.type, confirmAction.id);
          }
          setIsConfirmOpen(false);
        }}
        title="Konfirmasi Tindakan"
        message={`Apakah Anda yakin ingin menghapus/mereset ${confirmAction?.name || 'data ini'}? Tindakan ini tidak dapat dibatalkan.`}
      />
    </div>
  );
};


// --- JADWAL PELAJARAN TAB (Admin CRUD) ---
const JadwalPelajaranTab = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ hari: 'Senin', jam_ke: 1, jam_mulai: '', jam_selesai: '', mata_pelajaran: '', guru: '' });
  const [submitting, setSubmitting] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRows(await safeFetch('/api/jadwal-pelajaran')); } catch { }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.mata_pelajaran.trim()) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await safeFetch(`/api/jadwal-pelajaran/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
        toast.success('Jadwal diperbarui');
      } else {
        await safeFetch('/api/jadwal-pelajaran', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
        toast.success('Jadwal ditambahkan');
      }
      setShowForm(false); setEditingId(null);
      setForm({ hari: 'Senin', jam_ke: 1, jam_mulai: '', jam_selesai: '', mata_pelajaran: '', guru: '' });
      load();
    } catch (err: any) { toast.error(err.message); }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    setConfirmAction({
      title: 'Hapus Jadwal',
      message: 'Apakah Anda yakin ingin menghapus jadwal pelajaran ini? Tindakan ini tidak dapat dibatalkan.',
      onConfirm: async () => {
        try { await safeFetch(`/api/jadwal-pelajaran/${id}`, { method: 'DELETE' }); load(); toast.success('Dihapus'); } catch { }
      }
    });
    setConfirmOpen(true);
  };

  const handleImport = async () => {
    // Parse CSV: hari,jam_ke,jam_mulai,jam_selesai,mata_pelajaran,guru
    const lines = importText.trim().split('\n').filter(Boolean);
    const importRows = lines.map(l => {
      const [hari, jam_ke, jam_mulai, jam_selesai, mata_pelajaran, guru] = l.split(',').map(s => s.trim());
      return { hari, jam_ke: parseInt(jam_ke) || 1, jam_mulai, jam_selesai, mata_pelajaran, guru };
    }).filter(r => r.hari && r.mata_pelajaran);
    if (!importRows.length) { toast.error('Format tidak valid'); return; }
    try {
      await safeFetch('/api/jadwal-pelajaran/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: importRows }) });
      toast.success(`${importRows.length} jadwal diimport`);
      setShowImport(false); setImportText(''); load();
    } catch (err: any) { toast.error(err.message); }
  };

  const byDay = DAYS_ORDER.reduce((acc: any, d) => {
    acc[d] = rows.filter(r => r.hari === d).sort((a, b) => a.jam_ke - b.jam_ke);
    return acc;
  }, {});

  return (
    <div className="p-6 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Jadwal Pelajaran</h3>
          <p className="text-sm text-slate-500 font-medium">{rows.length} mata pelajaran terdaftar</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowImport(!showImport)} className="px-4 py-2.5 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl border border-blue-100 hover:bg-blue-100 transition-all flex items-center gap-1.5">
            <ClipboardPaste size={14} />Import CSV
          </button>
          <button onClick={() => {
            setConfirmAction({
              title: 'Reset Jadwal Pelajaran',
              message: 'Apakah Anda yakin ingin menghapus SEMUA DATA JADWAL PELAJARAN? Tindakan ini tidak dapat dibatalkan.',
              onConfirm: async () => { await safeFetch('/api/jadwal-pelajaran', { method: 'DELETE' }); load(); toast.success('Jadwal pelajaran direset'); }
            });
            setConfirmOpen(true);
          }}
            className="px-4 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 hover:bg-red-600 hover:text-white transition-all">Reset</button>
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ hari: 'Senin', jam_ke: 1, jam_mulai: '', jam_selesai: '', mata_pelajaran: '', guru: '' }); }}
            className="btn-primary px-4 py-2.5 flex items-center gap-2 text-sm">
            <Plus size={16} />Tambah
          </button>
        </div>
      </div>

      {/* Import CSV panel */}
      <AnimatePresence>
        {showImport && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6 overflow-hidden">
            <div className="p-5 bg-blue-50 border border-blue-100 rounded-2xl space-y-3">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">Import CSV — Format: hari,jam_ke,jam_mulai,jam_selesai,mata_pelajaran,guru</p>
              <textarea value={importText} onChange={e => setImportText(e.target.value)}
                className="w-full h-28 p-3 bg-white border border-blue-200 rounded-xl text-xs font-mono outline-none resize-none"
                placeholder={"Senin,1,07:00,07:45,Matematika,Bu Ani\nSenin,2,07:45,08:30,Bahasa Indonesia,Pak Budi"} />
              <div className="flex gap-2">
                <button onClick={handleImport} className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-all">Import</button>
                <button onClick={() => setShowImport(false)} className="px-4 py-2 bg-white text-slate-500 text-xs font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition-all">Batal</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-8 overflow-hidden">
            <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Hari</label>
                  <select className="input-field text-sm" value={form.hari} onChange={e => setForm(p => ({ ...p, hari: e.target.value }))}>
                    {DAYS_ORDER.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Jam ke-</label>
                  <input type="number" min={1} max={12} className="input-field text-sm" value={form.jam_ke} onChange={e => setForm(p => ({ ...p, jam_ke: parseInt(e.target.value) || 1 }))} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Mata Pelajaran</label>
                  <input type="text" className="input-field text-sm" placeholder="Matematika" value={form.mata_pelajaran} onChange={e => setForm(p => ({ ...p, mata_pelajaran: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Guru</label>
                  <input type="text" className="input-field text-sm" placeholder="Nama guru" value={form.guru} onChange={e => setForm(p => ({ ...p, guru: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Jam Mulai</label>
                  <input type="time" className="input-field text-sm" value={form.jam_mulai} onChange={e => setForm(p => ({ ...p, jam_mulai: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Jam Selesai</label>
                  <input type="time" className="input-field text-sm" value={form.jam_selesai} onChange={e => setForm(p => ({ ...p, jam_selesai: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} disabled={submitting || !form.mata_pelajaran.trim()} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-50">{editingId ? 'Simpan' : 'Tambah'}</button>
                <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-6 py-2.5 bg-white text-slate-500 font-bold text-sm rounded-2xl border border-slate-200 hover:bg-slate-50 transition-all">Batal</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="py-20 text-center">
          <BookOpenCheck size={40} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-400 font-medium">Belum ada jadwal pelajaran.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {DAYS_ORDER.filter(d => byDay[d].length > 0).map(day => (
            <div key={day} className="bg-slate-50 rounded-3xl border border-slate-100 overflow-hidden">
              <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
                <h4 className="font-bold text-emerald-800 text-sm uppercase tracking-widest">{day}</h4>
                <span className="text-[10px] font-bold text-emerald-500">{byDay[day].length} jam</span>
              </div>
              <div className="divide-y divide-slate-100">
                {byDay[day].map((r: any) => (
                  <div key={r.id} className="px-6 py-3 flex items-center gap-4 group hover:bg-white transition-colors">
                    <div className="w-8 h-8 bg-white border border-slate-200 text-slate-600 rounded-lg flex items-center justify-center font-black text-sm shrink-0">{r.jam_ke}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm">{r.mata_pelajaran}</p>
                      {r.guru && <p className="text-xs text-slate-400 font-medium">{r.guru}</p>}
                    </div>
                    {(r.jam_mulai || r.jam_selesai) && (
                      <span className="text-xs font-bold text-slate-400 shrink-0">{r.jam_mulai}{r.jam_selesai ? `–${r.jam_selesai}` : ''}</span>
                    )}
                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                      <button onClick={() => { setEditingId(r.id); setForm({ hari: r.hari, jam_ke: r.jam_ke, jam_mulai: r.jam_mulai || '', jam_selesai: r.jam_selesai || '', mata_pelajaran: r.mata_pelajaran, guru: r.guru || '' }); setShowForm(true); }}
                        className="p-2 sm:p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(r.id)} className="p-2 sm:p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { if (confirmAction) confirmAction.onConfirm(); setConfirmOpen(false); }}
        title={confirmAction?.title || 'Konfirmasi Tindakan'}
        message={confirmAction?.message || 'Apakah Anda yakin?'}
      />
    </div>
  );
};

// --- LAPORAN ANGGOTA TAB (replaces Violations) ---
const ViolationsTab = () => {
  const [summary, setSummary] = useState<any[]>([]);
  const [violations, setViolations] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<'anggota' | 'summary' | 'detail'>('anggota');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const STATUS_COLORS: Record<string, string> = {
    'Sakit (Dengan Surat)': 'bg-blue-100 text-blue-700 border-blue-200',
    'Sakit (Tanpa Surat)': 'bg-sky-100 text-sky-700 border-sky-200',
    'Alfa': 'bg-red-100 text-red-700 border-red-200',
    'Izin': 'bg-amber-100 text-amber-700 border-amber-200',
    'Izin Telat': 'bg-amber-100 text-amber-700 border-amber-200',
    'Dispen': 'bg-teal-100 text-teal-700 border-teal-200',
    'Tidak Piket': 'bg-red-100 text-red-700 border-red-200',
    'Telat': 'bg-amber-100 text-amber-700 border-amber-200',
  };

  const getStatusColor = (type: string) => STATUS_COLORS[type] || 'bg-slate-100 text-slate-700 border-slate-200';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [s, v, m] = await Promise.all([
          safeFetch('/api/violations/summary'),
          safeFetch('/api/violations'),
          safeFetch('/api/members'),
        ]);
        setSummary(s); setViolations(v); setMembers(m);
      } catch { }
      setLoading(false);
    };
    load();
  }, []);

  const toggleFolder = (key: string) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (id: number) => {
    setConfirmAction({
      title: 'Hapus Laporan',
      message: 'Apakah Anda yakin ingin menghapus data laporan ini? Tindakan ini tidak dapat dibatalkan.',
      onConfirm: async () => {
        try {
          await safeFetch(`/api/violations/${id}`, { method: 'DELETE' });
          setViolations(prev => prev.filter(v => v.id !== id));
          toast.success('Data laporan dihapus');
        } catch (err: any) { toast.error(err.message); }
      }
    });
    setConfirmOpen(true);
  };

  const handleReset = () => {
    setConfirmAction({
      title: 'Reset Laporan Anggota',
      message: 'Apakah Anda yakin ingin menghapus SEMUA DATA LAPORAN ANGGOTA & PELANGGARAN? Tindakan ini tidak dapat dibatalkan.',
      onConfirm: async () => {
        try {
          await safeFetch('/api/violations/reset', { method: 'POST' });
          setViolations([]);
          setSummary([]);
          toast.success('Semua data laporan anggota telah direset');
        } catch (err: any) { toast.error(err.message); }
      }
    });
    setConfirmOpen(true);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" /></div>;

  // Group violations by member name
  const violationsByMember: Record<string, { member: any; violations: any[] }> = {};
  for (const m of members) {
    violationsByMember[m.name] = { member: m, violations: [] };
  }
  for (const v of violations) {
    if (!violationsByMember[v.member_name]) {
      violationsByMember[v.member_name] = { member: { name: v.member_name }, violations: [] };
    }
    violationsByMember[v.member_name].violations.push(v);
  }
  // Only show members with violations
  const membersWithViolations = Object.entries(violationsByMember).filter(([, v]) => v.violations.length > 0);

  return (
    <div className="p-6 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Laporan Anggota</h3>
          <p className="text-sm text-slate-500 font-medium mt-0.5">Rekap ketidakhadiran & laporan per anggota</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
          <button onClick={handleReset}
            className="px-3 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 hover:bg-red-600 hover:text-white transition-all mr-2">
            Reset
          </button>
          {[
            { id: 'anggota', label: 'Per Anggota' },
            { id: 'summary', label: 'Ringkasan' },
            { id: 'detail', label: 'Detail' }
          ].map(t => (
            <button key={t.id} onClick={() => setActiveView(t.id as any)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${activeView === t.id ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Per Anggota: folder view grouped by member */}
      {activeView === 'anggota' && (
        <div className="space-y-2">
          {membersWithViolations.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 size={40} className="text-emerald-300 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">Belum ada laporan anggota tercatat.</p>
            </div>
          ) : membersWithViolations.map(([memberName, { violations: memberViolations }]) => {
            const folderKey = `member-${memberName}`;
            const isOpen = openFolders.has(folderKey);

            // Group by type
            const byType: Record<string, any[]> = {};
            for (const v of memberViolations) {
              if (!byType[v.type]) byType[v.type] = [];
              byType[v.type].push(v);
            }

            return (
              <div key={memberName} className="mb-2">
                <button onClick={() => toggleFolder(folderKey)}
                  className="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-100 transition-all group">
                  {isOpen ? <FolderOpen size={18} className="text-red-400" /> : <Folder size={18} className="text-slate-400 group-hover:text-red-400 transition-colors" />}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-800 truncate">{memberName}</span>
                    <div className="flex gap-1 flex-wrap">
                      {Object.entries(byType).map(([type, items]) => (
                        <span key={type} className={`px-1.5 py-0.5 text-[9px] font-black rounded-full border ${getStatusColor(type)}`}>
                          {type}: {items.length}x
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-400 shrink-0">{memberViolations.length} Catatan</span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="pl-4 pt-2 pb-3 space-y-1.5">
                        {/* Sub-folders by type */}
                        {Object.entries(byType).map(([type, typeViolations]) => {
                          const typeFolderKey = `${folderKey}-${type}`;
                          const isTypeOpen = openFolders.has(typeFolderKey);
                          return (
                            <div key={type}>
                              <button onClick={() => toggleFolder(typeFolderKey)}
                                className="w-full flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 rounded-xl border border-slate-100 transition-all group/sub">
                                {isTypeOpen ? <FolderOpen size={14} className="text-slate-400" /> : <Folder size={14} className="text-slate-300 group-hover/sub:text-slate-400" />}
                                <span className={`px-2 py-0.5 text-[10px] font-black rounded-full border ${getStatusColor(type)}`}>{type}</span>
                                <span className="text-xs font-bold text-slate-500 flex-1 text-left">{typeViolations.length}x Laporan</span>
                                <ChevronDown size={13} className={`text-slate-400 transition-transform ${isTypeOpen ? 'rotate-180' : ''}`} />
                              </button>
                              <AnimatePresence>
                                {isTypeOpen && (
                                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                    <div className="pl-4 pt-1.5 space-y-1">
                                      {typeViolations.map((v: any) => (
                                        <div key={v.id} className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 group/item hover:bg-red-50 hover:border-red-100 transition-all">
                                          <span className="text-[10px] font-bold text-slate-400 w-20 shrink-0">{v.date}</span>
                                          {v.notes && <span className="text-xs text-slate-500 italic flex-1 truncate">{v.notes}</span>}
                                          <button onClick={() => handleDelete(v.id)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-100 rounded-lg transition-all opacity-0 group-hover/item:opacity-100 shrink-0">
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {activeView === 'summary' && (
        <div>
          {summary.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 size={40} className="text-emerald-300 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">Belum ada pelanggaran tercatat.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {summary.map((s: any, i: number) => (
                <div key={s.member_name} className={`flex items-center gap-4 p-4 rounded-2xl border ${i === 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${i === 0 ? 'bg-red-600 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-sm">{s.member_name}</p>
                    <div className="flex gap-3 mt-1 flex-wrap">
                      {s.alfa > 0 && <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full border border-red-200">Alfa: {s.alfa}x</span>}
                      {s.sakit_tanpa_surat > 0 && <span className="text-[10px] font-bold text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full border border-sky-200">Sakit Tanpa Surat: {s.sakit_tanpa_surat}x</span>}
                      {s.telat > 0 && <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">Telat: {s.telat}x</span>}
                      {s.tidak_piket > 0 && <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full border border-red-200">Tidak Piket: {s.tidak_piket}x</span>}
                    </div>
                  </div>
                  <div className={`text-2xl font-black ${i === 0 ? 'text-red-600' : 'text-slate-400'}`}>{s.total_violations}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeView === 'detail' && (
        <div className="space-y-2">
          {violations.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 size={40} className="text-emerald-300 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">Tidak ada data laporan.</p>
            </div>
          ) : violations.map((v: any) => (
            <div key={v.id} className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100 group hover:bg-red-50 hover:border-red-100 transition-all">
              <div className={`px-2.5 py-1 rounded-lg text-[10px] font-black shrink-0 border ${getStatusColor(v.type)}`}>{v.type}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900">{v.member_name}</p>
                <p className="text-[10px] text-slate-400 font-medium">{v.date}</p>
              </div>
              {v.notes && <p className="text-xs text-slate-500 italic truncate max-w-[100px]">{v.notes}</p>}
              <button onClick={() => handleDelete(v.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { if (confirmAction) confirmAction.onConfirm(); setConfirmOpen(false); }}
        title={confirmAction?.title || 'Konfirmasi Tindakan'}
        message={confirmAction?.message || 'Apakah Anda yakin?'}
      />
    </div>
  );
};

const ReportCard = ({ report, onDelete, onPreview, onReact, onAdminEdit }: { report: any; key?: any; onDelete: () => void; onPreview: (src: string) => void; onReact?: () => void; onAdminEdit?: () => void }) => {
  // Cek apakah PJ tercatat absen (tidak hadir sendiri)
  const pjAbsent = (report.absents || []).find((a: any) => a.name === report.pj_name && a.reason && a.reason !== 'Hadir');
  const displayPjName = pjAbsent ? `${report.pj_name} (digantikan)` : report.pj_name;
  return (
    <div className="p-5 sm:p-6 rounded-3xl border border-slate-100 bg-slate-50/30 hover:bg-slate-50 transition-colors group">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-1/3 space-y-3">
          {report.cleaning_photo ? (
            <div className="aspect-video rounded-2xl overflow-hidden bg-slate-200 relative cursor-pointer group/img" onClick={() => onPreview(report.cleaning_photo)}>
              <img src={report.cleaning_photo} alt="Cleaning" className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/30 transition-all flex items-center justify-center">
                <Maximize2 size={20} className="text-white opacity-0 group-hover/img:opacity-100 transition-all" />
              </div>
              <div className="absolute top-3 left-3 px-2 py-1 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold rounded-full">Hasil Kebersihan</div>
            </div>
          ) : (
            <div className="aspect-video rounded-2xl bg-slate-100 flex items-center justify-center"><ImageIcon size={32} className="text-slate-300" /></div>
          )}
          {/* Foto Kehadiran lampiran */}
          {report.checkin_photo && (
            <div className="aspect-video rounded-2xl overflow-hidden bg-slate-200 relative cursor-pointer group/img2" onClick={() => onPreview(report.checkin_photo)}>
              <img src={report.checkin_photo} alt="Kehadiran" className="w-full h-full object-cover group-hover/img2:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-black/0 group-hover/img2:bg-black/30 transition-all flex items-center justify-center">
                <Maximize2 size={20} className="text-white opacity-0 group-hover/img2:opacity-100 transition-all" />
              </div>
              <div className="absolute top-3 left-3 px-2 py-1 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold rounded-full">Foto Kehadiran</div>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`text-sm font-bold ${pjAbsent ? 'text-amber-600' : 'text-emerald-600'}`}>{displayPjName}</p>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${report.status === 'Telat' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                  {report.status === 'Telat' ? '⚠ Telat' : '✓ Tepat Waktu'}
                </span>
                {report.is_read ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-600 border border-blue-100 animate-in fade-in zoom-in duration-300">
                    <Eye size={10} /> Sudah Dibaca Admin
                  </span>
                ) : onReact && report.checkin_photo && report.cleaning_photo ? (
                  <button onClick={onReact} className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-all active:scale-95 shadow-sm shadow-emerald-200 border border-emerald-500">
                    <CheckCircle size={11} />Tandai Dibaca
                  </button>
                ) : onReact ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                    <Eye size={10} /> Belum Dibaca
                  </span>
                ) : null}
              </div>
              <h4 className="text-base font-bold text-slate-900 mt-1">Laporan {report.date}</h4>
              <p className="text-xs text-slate-400 font-medium">{report.checkin_time} WIB</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onAdminEdit && (
                <button onClick={onAdminEdit} className="p-2 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Edit laporan"><Edit2 size={16} /></button>
              )}
              <button onClick={onDelete} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={16} /></button>
            </div>
          </div>
          {report.cleaning_description && report.cleaning_description !== 'Semua anggota hadir' && (
            <div className="p-4 bg-white rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Anggota Tidak Hadir</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-2 py-1.5 text-left font-bold text-slate-500 border border-slate-100 w-8">No</th>
                    <th className="px-2 py-1.5 text-left font-bold text-slate-500 border border-slate-100">Nama</th>
                    <th className="px-2 py-1.5 text-left font-bold text-slate-500 border border-slate-100">Keterangan</th>
                    <th className="px-2 py-1.5 text-center font-bold text-slate-500 border border-slate-100 w-16">Frekuensi</th>
                  </tr>
                </thead>
                <tbody>
                  {report.cleaning_description.split('\n').filter((l: string) => l.trim()).map((line: string, idx: number) => {
                    const parts = line.split(' - ');
                    const nama = parts[0]?.trim() || line;
                    const ket = parts.slice(1).join(' - ').trim() || '-';
                    const freq = (report.absents || []).filter((a: any) => a.name === nama).length || 1;
                    return (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="px-2 py-1.5 text-center text-slate-400 border border-slate-100 font-medium">{idx + 1}</td>
                        <td className="px-2 py-1.5 font-semibold text-slate-800 border border-slate-100">{nama}</td>
                        <td className="px-2 py-1.5 text-slate-600 border border-slate-100">{ket}</td>
                        <td className="px-2 py-1.5 text-center border border-slate-100">
                          <span className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded font-bold">{freq}x</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {report.cleaning_description === 'Semua anggota hadir' && (
            <div className="px-4 py-2 bg-emerald-50 rounded-xl inline-block text-emerald-700 text-xs font-bold">✓ Semua anggota hadir</div>
          )}
        </div>
      </div>
    </div>
  );
};

const MemberCard = ({ member, users, onEdit, onDelete, onPromote, onSubstitute }: { member: ClassMember; key?: any; users: User[]; onEdit: () => void; onDelete: () => void; onPromote: () => void; onSubstitute?: () => void }) => {
  const isActualPJ = !!member.is_pj_group || users.some(u => u.name === member.name && u.role === 'pj');
  const isInAnotherGroup = !!member.pj_id;

  const handlePromoteClick = () => {
    if (isInAnotherGroup) {
      toast.error("Anggota yang bersangkutan harus dilepas dulu status PJ-nya di kelompok lama sebelum bisa ditunjuk menjadi PJ di kelompok baru.");
      return;
    }
    onPromote();
  };

  return (
    <div className={`p-4 rounded-2xl border flex items-center justify-between group transition-all ${isActualPJ ? 'bg-blue-50/80 border-blue-200 hover:bg-blue-100/80 hover:border-blue-300' : 'bg-slate-50/50 border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold shadow-sm text-sm transition-colors ${isActualPJ ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 group-hover:text-emerald-600'}`}>
          {member.name.charAt(0)}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className={`text-sm font-bold ${isActualPJ ? 'text-blue-900' : 'text-slate-900'}`}>{member.name}</p>
            {isActualPJ && <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">PJ</span>}
          </div>
          {!isActualPJ && (
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
              PJ: {users.find(u => u.id === member.pj_id)?.name || 'Tidak Ada'}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
        {!isActualPJ && (
          <button onClick={handlePromoteClick} title={isInAnotherGroup ? "Lepas dari PJ kelompok terlebih dahulu" : "Jadikan PJ"}
            className={`p-2 sm:p-1.5 rounded-lg transition-all ${isInAnotherGroup ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'}`}>
            <ShieldCheck size={15} />
          </button>
        )}
        <button onClick={onEdit} className="p-2 sm:p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"><Edit2 size={15} /></button>
        <button onClick={onDelete} className="p-2 sm:p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={15} /></button>
      </div>
    </div>
  );
};

// --- MAIN APP ---
export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('klasik_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [adminExists, setAdminExists] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [showAboutGlobal, setShowAboutGlobal] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    safeFetch('/api/admin-exists').then(d => setAdminExists(d.exists)).catch(() => setAdminExists(false));
    if (user) safeFetch('/api/settings').then(setSettings).catch(() => { });
  }, [user]);

  const handleLogin = (u: User) => {
    setUser(u);
    localStorage.setItem('klasik_user', JSON.stringify(u));
    safeFetch('/api/settings').then(setSettings).catch(() => { });
  };

  const handleLogout = () => {
    setUser(null);
    setIsGuest(false);
    localStorage.removeItem('klasik_user');
  };

  const handleSetup = (code: string) => {
    setAdminExists(true);
  };

  // Setup page — null means still loading (prevents race condition flash)
  if (adminExists === null) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (adminExists === false) return <SetupPage onSetup={handleSetup} />;

  // Guest mode
  if (isGuest) return <GuestPanel onBack={() => setIsGuest(false)} />;

  // Login
  if (!user) return <LoginPage onLogin={handleLogin} onGuest={() => setIsGuest(true)} />;


  return (
    <div className="min-h-screen bg-slate-50 pb-12"
      onContextMenu={(e) => e.preventDefault()}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' as any }}>
      <ToastContainer />
      {showAboutGlobal && <AboutModal onClose={() => setShowAboutGlobal(false)} />}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 sm:px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-emerald-600 text-white rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-100 shrink-0">
              <ShieldCheck size={20} />
            </div>
            <h1 className="font-bold text-slate-900 text-base sm:text-lg tracking-tight hidden sm:block truncate">Manajemen Kelas</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-bold text-slate-900 truncate max-w-[120px]">{user.name}</span>
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{user.role}</span>
            </div>
            <div className="w-px h-7 bg-slate-200 hidden sm:block" />
            <button onClick={() => setShowAboutGlobal(true)} className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all" title="Tentang Aplikasi">
              <BookOpen size={18} />
            </button>
            <button onClick={handleLogout} className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Keluar">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <main className="py-6 sm:py-8">
        {user.role === 'admin'
          ? <AdminDashboard user={user} onLoginAs={handleLogin} />
          : <PJDashboard user={user} />
        }
      </main>
    </div>
  );
}