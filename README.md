# 🎓 KlaSik (Kelas Asik)

> Manajemen Kelas Jadi Lebih Seru dan Terstruktur.

KlaSik adalah solusi digital modern untuk mengelola ekosistem kelas. Dari jadwal piket hingga manajemen inventaris, semuanya dikemas dalam antarmuka yang interaktif dan responsif. Tidak ada lagi drama jadwal piket yang hilang atau koordinasi kelas yang berantakan.

## 🚀 Basis dan Fungsi

Proyek ini dibangun dengan *stack* teknologi terkini untuk memastikan performa yang cepat dan pengalaman pengguna yang mulus:

* **Frontend:** React + TypeScript (Vite) untuk UI yang *type-safe* dan cepat.
* **Styling:** Tailwind CSS untuk desain utilitas yang modern.
* **Animasi:** Framer Motion untuk transisi antar halaman yang "Asik".
* **Backend:** Express.js yang berjalan di lingkungan Node.js.
* **Database:** SQLite (Lokal) & Turso (Produksi) untuk penyimpanan data berbasis LibSQL yang *edge-ready*.
* **Deployment:** Netlify untuk hosting frontend dan serverless functions.

## 🛠️ Cara Kerja Proyek

1. **Frontend (React):** Menangani antarmuka pengguna. State manajemen memastikan data yang ditampilkan selalu sinkron dengan server.
2. **API Layer (Express):** Bertindak sebagai jembatan. Setiap perubahan (misal: mencentang tugas piket) akan mengirimkan *request* ke API.
3. **Database (Turso/SQLite):** Menyimpan data secara persisten. Saat di lokal, ia menggunakan file `.db` sederhana. Saat di-deploy, ia menggunakan **Turso** agar data bisa diakses dari mana saja dengan latensi rendah.
4. **Tailwind CSS:** Untuk desain utilitas yang modern.
5. **Framer Motion:** Memberikan *feedback* visual saat pengguna berinteraksi, membuat aplikasi terasa lebih hidup (hidup = Asik).

## 💻 Cara Hosting Lokal

Ikuti langkah-langkah ini untuk menjalankan KlaSik di komputer kamu:

### 1. Clone Repository

```bash
git clone https://github.com/mynamethiris/KlaSik.git
cd KlaSik
```

Pastikan kamu sudah menginstall Git di komputermu. Jika belum, silahkan install terlebih dahulu.

### 2. Instalasi Dependensi

```bash
npm install
```

Pastikan kamu sudah menginstall Node.js di komputermu. Jika belum, silahkan install terlebih dahulu.

### 3. Jalankan Mode Development

```bash
npm run dev
```

Aplikasi akan berjalan di `http://localhost:3000`.

## 🌐 Cara Hosting (Netlify + Turso)

Ikuti langkah-langkah ini untuk menghosting KlaSik di Netlify:

### 1. Database (Turso)

* Buat akun di [Turso](https://turso.tech/).
* Buat database baru via Turso CLI atau Dashboard.
* Dapatkan **Database URL** dan **Auth Token**.

### 2. Frontend & Backend (Netlify)

* Hubungkan repo GitHub kamu ke **Netlify**.
* Set **Build Command**: `npm run build` (Jika menggunakan Netlify Functions untuk Express).
* Set **Publish Directory**: `dist`.
* **Input Environment Variables** di Netlify Settings:

* `TURSO_DATABASE_URL`: (Dari langkah Turso)
* `TURSO_AUTH_TOKEN`: (Dari langkah Turso)

* Klik **Deploy**.

## Kontribusi

Proyek ini adalah proyek pribadi yang saya buat ketika saya belajar database dan web development. Jadi, saya menerima kritik dan saran untuk pengembangan proyek ini dengan cara melakukan pull request atau membuka issue.
