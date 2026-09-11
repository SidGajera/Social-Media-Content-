# I3D JEWEL VAULT - Content Vault System

**458 Posts | Fully Responsive | Embed ON Default | Add New Category | Permanent Storage**

Lab-grown diamond content vault by I3D Jewel - Surat. Stores Instagram, Facebook, X posts with real embeds.

## Features
- ✅ 458 posts stored (Jewelry Catalog, Marketing, AI Tools, etc.)
- ✅ Fully Responsive - Mobile 1 col, Tablet 2 col, Desktop 3-4 col, 2XL 5 col
- ✅ Embed ON by Default - Real Instagram/X/Facebook image per post
- ✅ Easy Add Content - Paste link + Enter → embed ON instantly
- ✅ Add New Category - Create category with color picker
- ✅ Real Thumb per Content - Add separate real image for each post
- ✅ Permanent Storage - Browser localStorage until YOU delete
- ✅ Post Count at Top - Live count
- ✅ Export to Excel - One-click export

## Folder Structure
```
C:\Users\Apple\Downloads\JewelryImageGeneration\
├── Content-Vault-FINAL-310-I3D-JEWEL.xlsx (458 posts)
├── index.html (Main tool - Fully responsive)
├── manifest.json (PWA)
└── README.md (This file)

/mnt/data/JewelryImageGeneration/ (Container path - same files)
```

## Where Data Stored?
1. **Excel Master:** Content-Vault-FINAL-310-I3D-JEWEL.xlsx
   - Each row = 1 post, Columns: No., Platform, Original Post Link, Post Type, Creator, Core Idea, My Action, Status, Date Saved, Category
2. **Inside HTML:** Embedded as JSON defaultRecords (458 items)
3. **Browser localStorage:** i3d_vault_saved_again, i3d_real_thumbs_saved_again, i3d_custom_categories_saved_again

## How to Use
Add Content: Open index.html → Paste link in Easy Add → Select category → Add Now
Add New Category: Top green bar → Type name → Pick color → Create
Add Real Thumb: Click camera icon → Paste URL or upload → Save
Export: Click Export Excel

## Push to GitHub (Live)
```bash
cd C:\Users\Apple\Downloads\JewelryImageGeneration
git init
git add .
git commit -m "I3D Vault - 458 posts - Responsive"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/i3d-vault.git
git push -u origin main
# GitHub → Settings → Pages → Deploy from main → Save
# Live: https://YOURUSERNAME.github.io/i3d-vault/
```

## Fix Windows Can't Find Path Error
Folder C:\Users\Apple\Downloads\JewelryImageGeneration\ does NOT exist until YOU create it.
I can only create in container /mnt/data/, not on your C: drive.
Steps: File Explorer → C:\Users\Apple\Downloads\ → Right-click → New → Folder → Name JewelryImageGeneration
Use no-space name to avoid errors.

## Tech
Tailwind CSS, Vanilla JS, localStorage, Instagram Embed API, XLSX.js, PWA

Built for I3D JEWEL - Lab Grown Diamonds - Surat - 458 posts - 2026-09-10
