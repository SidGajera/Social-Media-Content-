# 💎 Social Media Content Vault - I3D Jewel

A high-performance, responsive Social Media Content Vault & Management System built for **I3D Jewel**. Designed for organizing, embedding, filtering, and permanently storing social media content posts and custom categories directly in **MySQL** and a local **SQL Database Engine**.

---

## 🚀 Highlights & Features

- **490 Posts & 24 Custom Categories**: Pre-loaded with complete takeaways, platforms, links, and media previews.
- **Dual SQL & MySQL Database Backend**:
  - **MySQL Database (`social_media_vault`)**: Connects to `127.0.0.1:3306` with automatic table creation (`social_media_posts` & `social_media_meta`) and auto-seeding.
  - **Local SQL Database Engine**: Built-in zero-latency SQL database (`social_media_vault.db`) ensuring 100% offline availability and instant responses.
  - **Vault Backup (`vault.json`)**: Automatic JSON snapshot synchronization.
- **Zero Data Loss**: Non-destructive category & post merging on background sync. Newly added custom categories and posts are preserved permanently.
- **Add Content & Category Tools**:
  - **Quick Add Bar & Add Content Modal**: Add posts via link with thumbnail generation, extra URLs, and takeaways.
  - **Add Custom Category**: Create categories with custom color pickers and descriptions.
- **Rich Media & Filter System**: Live video/image embeds, multi-category chips, platform filters, status tracking, and 1-click Excel export.

---

## 📁 Repository Structure

```text
Social-Media-Content-/
├── index.html                           # Frontend Single Page Application (HTML/Tailwind/JS)
├── server.js                            # Node.js Database Backend Server (Port 3000)
├── vault.json                           # Canonical JSON Snapshot (490 Posts, 24 Categories)
├── Content-Vault-FINAL-310-I3D-JEWEL.xlsx # Master Reference Excel Sheet
├── package.json                         # Node.js Dependencies (mysql2, xlsx)
├── manifest.json                        # Progressive Web App (PWA) Manifest
└── README.md                            # Documentation
```

---

## 📡 API Endpoints

The backend server exposes the following endpoints:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `GET /api/mysql/posts` | `GET` | Fetches all posts, custom categories, deleted records, and thumbnails from SQL/MySQL. |
| `POST /api/mysql/sync` | `POST` | Stores posts, custom categories, and metadata permanently in SQL/MySQL and updates `vault.json`. |
| `GET /api/status` | `GET` | Returns server status, active record count, and MySQL connection state. |

---

## 🛠️ How to Run

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Backend Server
```bash
node server.js
```
Open the server URL in your web browser.

---

## 🗄️ MySQL Setup (Optional / Recommended)

To connect the system to your local MySQL database:

1. **Start MySQL Service**:
   - Open **XAMPP Control Panel** (or your local MySQL service) and click **Start** next to **MySQL**.
2. **Auto Connection & Seeding**:
   - `server.js` will automatically connect to MySQL on `127.0.0.1:3306`.
   - Database `social_media_vault` and tables `social_media_posts` & `social_media_meta` will be created automatically, and all 490 posts will be seeded into MySQL!

---

## 📝 GitHub Repository

- **Repository**: `https://github.com/SidGajera/Social-Media-Content-.git`
- **Branch**: `main`

---
*Built for I3D JEWEL - Surat*
