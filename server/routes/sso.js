const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

router.post('/vtab-sso', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Missing token' });

        const ssoSecret = process.env.VTAB_SSO_SECRET;
        if (!ssoSecret) return res.status(500).json({ error: 'Server missing SSO secret' });

        const decoded = jwt.verify(token, ssoSecret, {
            algorithms: ['HS256'],
            audience: 'postgres-converter',
            issuer: 'vtab360'
        });

        if (decoded.purpose !== 'vtab_sso') {
            return res.status(400).json({ error: 'Invalid token purpose' });
        }

        const email = decoded.email.toLowerCase();

        // Connect to Supabase
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Server missing Supabase credentials' });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Get Supabase user by email via admin API
        const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
        if (userError) throw userError;
        
        const existingUser = users.find(u => u.email === email);
        if (!existingUser) {
            return res.status(403).json({ error: 'SSO user is not registered in this application.' });
        }

        // 2. Generate magic link for that email
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: email,
        });

        if (linkError) throw linkError;

        // Return the magic link directly so the frontend can redirect to it
        res.json({ magicLink: linkData.properties.action_link });

    } catch (err) {
        console.error('VTAB SSO Error:', err);
        res.status(401).json({ error: 'Invalid or expired SSO token.' });
    }
});

module.exports = router;
