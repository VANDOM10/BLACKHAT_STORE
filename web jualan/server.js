require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet'); // Untuk HTTP Security Headers
const rateLimit = require('express-rate-limit'); // Untuk Rate Limiting
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'; // URL frontend Anda
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Middleware
const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10, // Batasi 10 permintaan per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Terlalu banyak permintaan, silakan coba lagi nanti." }
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "https://accounts.google.com/gsi/client"],
            "frame-src": ["'self'", "https://accounts.google.com/gsi/"],
            "connect-src": ["'self'", "https://accounts.google.com/gsi/", FRONTEND_URL],
            "img-src": ["'self'", "data:", "https://lh3.googleusercontent.com"], // Untuk foto profil Google
        },
    },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: { policy: "cross-origin" }
})); 
app.use(cors({ origin: FRONTEND_URL })); // Batasi CORS hanya untuk frontend Anda
app.use(bodyParser.json());
app.use(morgan('dev')); // Logger untuk memantau request

// Melayani file HTML statis dari direktori saat ini
// Dalam produksi, Anda mungkin akan menyajikan frontend secara terpisah (misalnya dengan Nginx)
// atau dari folder 'build' jika menggunakan framework seperti React/Vue.

// Melayani file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: jika route bukan API, kembalikan index.html (SPA/landing page)
app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Data Game (Dalam aplikasi nyata, ini diambil dari Database seperti MySQL/MongoDB)
const gamesData = {
    mlbb: {
        name: "Mobile Legends: Bang Bang",
        requiresServerId: true,
        amounts: [
            { id: 'mlbb-1', diamonds: 86, price: 25000 },
            { id: 'mlbb-2', diamonds: 172, price: 50000 },
            { id: 'mlbb-3', diamonds: 257, price: 75000 },
            { id: 'mlbb-4', diamonds: 344, price: 100000 },
        ]
    },
    freefire: {
        name: "Free Fire",
        requiresServerId: false,
        amounts: [
            { id: 'ff-1', diamonds: 70, price: 10000 },
            { id: 'ff-2', diamonds: 140, price: 20000 },
            { id: 'ff-3', diamonds: 210, price: 30000 },
            { id: 'ff-4', diamonds: 355, price: 50000 },
        ]
    },
    genshin: {
        name: "Genshin Impact",
        requiresServerId: false,
        amounts: [
            { id: 'genshin-1', genesis: 60, price: 15000 },
            { id: 'genshin-2', genesis: 300, price: 75000 },
            { id: 'genshin-3', genesis: 980, price: 225000 },
        ]
    },
    valorant: {
        name: "Valorant",
        requiresServerId: false,
        amounts: [
            { id: 'valo-1', vp: 125, price: 15000 },
            { id: 'valo-2', vp: 420, price: 50000 },
            { id: 'valo-3', vp: 700, price: 85000 },
        ]
    }
};

// Endpoint untuk mengambil data game
app.get('/api/games', (req, res) => {
    res.json(gamesData);
});

// Endpoint untuk verifikasi Login Google
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        // Di sini Anda bisa menyimpan user ke database jika belum ada
        console.log("User Logged In:", payload.name, payload.email);
        
        res.json({ success: true, user: payload });
    } catch (error) {
        console.error("Google Auth Error:", error);
        res.status(401).json({ success: false, message: "Token tidak valid" });
    }
});

// Endpoint untuk membuat pesanan
app.post('/api/orders', orderLimiter, (req, res) => {
    const { gameId, userID, serverID, amountId, price, paymentMethod } = req.body;
    
    // 1. Validasi Kelengkapan Data
    if (!gameId || !userID || !amountId || !price || !paymentMethod) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap" });
    }

    const game = gamesData[gameId];
    if (!game) {
        return res.status(404).json({ success: false, message: "Game tidak ditemukan" });
    }

    // 2. Validasi Server ID jika game membutuhkannya
    if (game.requiresServerId && !serverID) {
        return res.status(400).json({ success: false, message: "Server ID wajib diisi untuk game ini" });
    } 

    // 3. KEAMANAN: Validasi Harga (Mencegah manipulasi harga dari browser)
    const validAmount = game.amounts.find(a => a.id === amountId);
    if (!validAmount || validAmount.price !== price) {
        return res.status(400).json({ success: false, message: "Manipulasi harga terdeteksi!" });
    }

    // 4. Buat Order ID yang unik
    const orderId = `TRX-${uuidv4().substring(0, 8).toUpperCase()}`;
    
    try {
        setTimeout(() => {
            const finalOrder = {
                orderId,
                gameName: game.name,
                userID,
                serverID: serverID || 'N/A',
                item: validAmount.diamonds || validAmount.genesis || validAmount.vp,
                price,
                paymentMethod,
                status: 'PENDING',
                createdAt: new Date()
            };
            
            console.log("=== Pesanan Baru Dibuat ===");
            console.table(finalOrder);

            res.json({ 
                success: true, 
                message: "Pesanan berhasil dibuat! Anda akan dialihkan ke gerai pembayaran.", 
                orderId,
                paymentUrl: `https://checkout-sim.blackhat.store/pay/${orderId}`
            });
        }, 800);

    } catch (error) {
        console.error("Gagal memproses pesanan atau menghubungi Payment Gateway:", error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan sistem internal." });
    }
});

// Global Error Handling Middleware (harus diletakkan paling akhir)
app.use((err, req, res, next) => {
    console.error(err.stack); // Log error stack untuk debugging
    res.status(500).json({ success: false, message: "Terjadi kesalahan server internal. Mohon coba lagi nanti." });
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
