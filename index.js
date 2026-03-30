const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.post('/api/users/sync', async (req, res) => {
    const { id, fullname, username, avatar_url } = req.body;
    const { data, error } = await supabase
        .from('profiles')
        .upsert({ id, fullname, username, avatar_url });
    
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Đồng bộ thành công", data });
});

app.post('/api/restaurants', async (req, res) => {
    const { name, address, type, price, image_urls, lat, lng, description } = req.body;
    const { data, error } = await supabase.from('restaurants').insert([{
        name, address, type, price, image_urls, description,
        location: `POINT(${lng} ${lat})`
    }]);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Thêm quán thành công", data });
});

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
        user_lat: parseFloat(lat),
        user_lng: parseFloat(lng),
        radius_meters: parseInt(radius),
        meal_type: mealType
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

app.post('/api/reviews', async (req, res) => {
    const { restaurant_id, user_id, rating, comment } = req.body;
    const { data, error } = await supabase
        .from('reviews')
        .insert([{ restaurant_id, user_id, rating, comment }]);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Gửi đánh giá thành công", data });
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
        .order('rating', { ascending: false }); 

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend FoodTour running on port ${PORT}`));
