const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const admin = require('firebase-admin'); // Import Firebase Admin
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
    // Lấy thời gian hiện tại
    const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    
    console.log(`\n[${time}] 🚀 ${req.method} ${req.originalUrl}`);
    
    // Nếu API có gửi data trên URL (Ví dụ: ?lat=...&lng=...)
    if (Object.keys(req.query).length > 0) {
        console.log('   👉 Query:', req.query);
    }
    
    // Nếu API có gửi data trong Body (Ví dụ: Thêm quán, viết đánh giá)
    if (Object.keys(req.body).length > 0) {
        console.log('   📦 Body:', req.body);
    }
    
    next(); // Cực kỳ quan trọng: Cho phép request đi tiếp xuống các API bên dưới
});

// Khởi tạo Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    console.warn("CẢNH BÁO: Chưa cấu hình biến môi trường FIREBASE_SERVICE_ACCOUNT trên Render");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ==========================================
// MIDDLEWARE: CỔNG BẢO VỆ API (KIỂM TRA TOKEN)
// ==========================================
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Không tìm thấy Token. Từ chối truy cập." });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
        // Firebase kiểm tra tính hợp lệ của Token
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // Token hợp lệ, gắn thông tin user vào request để dùng phía sau
        next(); // Cho đi tiếp vào API
    } catch (error) {
        console.error("Lỗi xác thực Token:", error.message);
        return res.status(401).json({ message: "Token không hợp lệ hoặc đã hết hạn." });
    }
};

// ==========================================
// CÁC API CẦN BẢO VỆ (THÊM CHỮ verifyToken)
// ==========================================

app.post('/api/users/sync', verifyToken, async (req, res) => {
    const { id, fullname, username, avatar_url } = req.body;
    
    // Bảo mật: Đảm bảo user chỉ có thể đồng bộ thông tin của chính họ
    if (req.user.uid !== id) {
        return res.status(403).json({ message: "Bạn không có quyền cập nhật người dùng khác" });
    }

    const { data, error } = await supabase
        .from('profiles')
        .upsert({ id, fullname, username, avatar_url });
    
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Đồng bộ thành công", data });
});

app.post('/api/restaurants', verifyToken, async (req, res) => {
    const { name, address, type, price, image_urls, lat, lng, description } = req.body;
    const { data, error } = await supabase.from('restaurants').insert([{
        name, address, type, price, image_urls, description,
        location: `POINT(${lng} ${lat})`
    }]);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Thêm quán thành công", data });
});

app.post('/api/reviews', verifyToken, async (req, res) => {
    const { restaurant_id, user_id, rating, comment } = req.body;
    
    // Bảo mật: Đảm bảo user không thể dùng UID của người khác để đánh giá
    if (req.user.uid !== user_id) {
        return res.status(403).json({ message: "Bạn không thể đánh giá thay người khác" });
    }

    const { data, error } = await supabase
        .from('reviews')
        .insert([{ restaurant_id, user_id, rating, comment }]);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Gửi đánh giá thành công", data });
});


// ==========================================
// CÁC API PUBLIC (AI CŨNG ĐƯỢC XEM, KHÔNG CẦN TOKEN)
// ==========================================

app.get('/api/restaurants/in-bounds', async (req, res) => {
    const { minLat, minLng, maxLat, maxLng } = req.query;
    const { data, error } = await supabase.rpc('get_restaurants_in_view', {
        min_lat: parseFloat(minLat), min_lng: parseFloat(minLng),
        max_lat: parseFloat(maxLat), max_lng: parseFloat(maxLng)
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.get('/api/restaurants/suggestions', async (req, res) => {
    const { lat, lng, radius = 5000 } = req.query;
    const hour = new Date().getHours(); 
    
    let mealType = 'Cà phê';
    if (hour >= 6 && hour < 10) mealType = 'Bữa sáng';
    else if (hour >= 11 && hour < 14) mealType = 'Bữa trưa';
    else if (hour >= 18 && hour < 22) mealType = 'Bữa tối';

    const { data, error } = await supabase.rpc('suggest_restaurants', {
        user_lat: parseFloat(lat), user_lng: parseFloat(lng),
        radius_meters: parseInt(radius), meal_type: mealType
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ meal_type: mealType, restaurants: data });
});

app.get('/api/restaurants/:id/reviews', async (req, res) => {
    const { data, error } = await supabase
        .from('reviews')
        .select('*, profiles(fullname, avatar_url)')
        .eq('restaurant_id', req.params.id)
        .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.get('/api/users/:uid/history', async (req, res) => {
    const { data, error } = await supabase
        .from('reviews')
        .select('rating, comment, created_at, restaurants(*)')
        .eq('user_id', req.params.uid)
        .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.get('/api/restaurants', async (req, res) => {
    const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .order('rating', { ascending: false }); 

    if (error) return res.status(400).json({ error: error.message });

    const formattedData = data.map(item => ({
        ...item,
        name: item.name || item.Name,
        address: item.address || item.Address,
        type: item.type || item.Type,
        price: item.price || item.Price,
        rating: item.rating || item.Rating,
        description: item.description || item.Review
    }));

    res.json(formattedData);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend FoodTour running on port ${PORT}`));
