const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DRIVERS_FILE = path.join(__dirname, 'drivers.json');

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// Create the driver data file once. Keep phone numbers as strings.
if (!fs.existsSync(DRIVERS_FILE)) {
  const initialDrivers = [
    {
      name: 'မောင်သူရိန်မျိုး',
      phone: '09405005672',
      car: 'Toyota Alphard (SHAN38-7890)',
      image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100',
      passcode: '123456',
      approved: true
    },
    {
      name: 'ကိုစိုးမိုး',
      phone: '09987654321',
      car: 'Toyota Crown (ခ-၅၆၇၈)',
      image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100',
      passcode: '123456',
      approved: true
    }
  ];
  fs.writeFileSync(DRIVERS_FILE, JSON.stringify(initialDrivers, null, 2));
}

function readDrivers() {
  const data = JSON.parse(fs.readFileSync(DRIVERS_FILE, 'utf8'));
  if (!Array.isArray(data)) throw new Error('drivers.json must contain an array');
  return data;
}

function writeDrivers(drivers) {
  fs.writeFileSync(DRIVERS_FILE, JSON.stringify(drivers, null, 2));
}

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/driver.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'driver.html')));
app.get('/register-driver.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'register-driver.html')));

app.get('/api/drivers', (_req, res) => {
  try {
    // Never expose passcodes to the public driver list.
    res.json(readDrivers().map(({ passcode, ...driver }) => driver));
  } catch (err) {
    console.error('Read drivers failed:', err);
    res.status(500).json({ success: false, message: 'ယာဉ်မောင်းစာရင်း ဖတ်မရပါ။' });
  }
});

app.get('/api/online-drivers', (_req, res) => {
  res.json(onlineDrivers);
});

// One registration endpoint only.
app.post('/api/register-driver', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const car = String(req.body.car || '').trim();
    const image = String(req.body.image || '').trim();
    const suppliedPasscode = String(req.body.passcode || '').trim();

    if (!phone) {
      return res.status(400).json({ success: false, message: 'ဖုန်းနံပါတ် လိုအပ်ပါသည်။' });
    }

    const drivers = readDrivers();
    const existing = drivers.find(d => String(d.phone) === phone);
    const passcode = suppliedPasscode || (existing && existing.passcode) || String(Math.floor(100000 + Math.random() * 900000));

    if (existing) {
      if (name) existing.name = name;
      if (car) existing.car = car;
      if (image) existing.image = image;
      existing.passcode = passcode;
      existing.approved = true;
    } else {
      drivers.push({
        name: name || 'Driver',
        phone,
        car: car || 'ကားအမျိုးအစား မသတ်မှတ်ရသေးပါ',
        image: image || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
        passcode,
        approved: true,
        registeredAt: new Date().toISOString()
      });
    }

    writeDrivers(drivers);
    res.json({ success: true, message: 'ယာဉ်မောင်းစာရင်းသွင်းမှု အောင်မြင်ပါသည်။', passcode });
  } catch (err) {
    console.error('Register driver failed:', err);
    res.status(500).json({ success: false, message: 'ဆာဗာအမှားအယွင်း ရှိနေပါသည်။' });
  }
});

app.post('/api/driver-login', (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const passcode = String(req.body.passcode || '').trim();
    const driver = readDrivers().find(d => String(d.phone) === phone);
    if (!driver) return res.status(401).json({ success: false, message: 'ဤဖုန်းနံပါတ်ဖြင့် မှတ်ပုံတင်ထားခြင်း မရှိပါ။' });
    if (!driver.approved) return res.status(403).json({ success: false, message: 'Admin အတည်ပြုချက် လိုအပ်ပါသည်။' });
    if (String(driver.passcode || '') !== passcode) return res.status(401).json({ success: false, message: 'Passcode မှားယွင်းနေပါသည်။' });
    res.json({ success: true, driver: { name: driver.name, phone: driver.phone } });
  } catch (err) {
    console.error('Driver login failed:', err);
    res.status(500).json({ success: false, message: 'ဆာဗာအမှားအယွင်း ရှိနေပါသည်။' });
  }
});

app.delete('/api/drivers/:phone', (req, res) => {
  try {
    const phone = String(req.params.phone || '');
    const drivers = readDrivers();
    const remaining = drivers.filter(d => String(d.phone) !== phone);
    if (remaining.length === drivers.length) return res.status(404).json({ success: false, message: 'ယာဉ်မောင်း မတွေ့ပါ။' });
    writeDrivers(remaining);
    res.json({ success: true, message: 'ယာဉ်မောင်းကို ဖယ်ရှားပြီးပါပြီ။' });
  } catch (err) {
    console.error('Delete driver failed:', err);
    res.status(500).json({ success: false, message: 'ဆာဗာအမှားအယွင်း ရှိနေပါသည်။' });
  }
});

// phone -> socket.id
const onlineDrivers = Object.create(null);

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('driverOnline', data => {
    const phone = String(data && data.phone || '').trim();
    if (!phone) return;
    onlineDrivers[phone] = socket.id;
    socket.driverPhone = phone;
    io.emit('updateDriverStatus', { phone, status: 'online' });
  });

  socket.on('passengerRequestRide', data => {
    if (!data) return;
    const phone = String(data.targetDriverPhone || data.driverPhone || '').trim();
    const driverSocketId = onlineDrivers[phone];
    if (!driverSocketId) {
      socket.emit('rideRequestFailed', { message: 'ယာဉ်မောင်းသည် Offline ဖြစ်နေပါသည်။' });
      return;
    }
    io.to(driverSocketId).emit('passengerRequestRide', {
      passengerId: socket.id,
      lat: Number(data.lat),
      lng: Number(data.lng),
      destLat: data.destLat == null ? null : Number(data.destLat),
      destLng: data.destLng == null ? null : Number(data.destLng),
      passengerName: data.passengerName || 'ခရီးသည်',
      passengerPhone: data.passengerPhone || 'N/A'
    });
  });

  // Passenger live GPS updates are forwarded to online drivers.
  socket.on('liveLocationUpdate', data => {
    if (!data || !Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lng))) return;
    const payload = {
      id: socket.id,
      passengerId: socket.id,
      lat: Number(data.lat),
      lng: Number(data.lng),
      destLat: data.destLat == null ? null : Number(data.destLat),
      destLng: data.destLng == null ? null : Number(data.destLng)
    };
    for (const driverSocketId of Object.values(onlineDrivers)) {
      io.to(driverSocketId).emit('liveLocationUpdate', payload);
    }
  });

  socket.on('selectDriver', data => {
    if (!data || !data.driverSocketId) return;
    io.to(data.driverSocketId).emit('rideAssigned', {
      passengerId: socket.id,
      pickupLat: data.passengerLat,
      pickupLng: data.passengerLng,
      destLat: data.destLat,
      destLng: data.destLng,
      passengerName: data.passengerName || 'ခရီးသည်',
      passengerPhone: data.passengerPhone || 'N/A'
    });
  });

  socket.on('acceptRide', data => {
    if (!data || !data.passengerId) return;
    io.to(data.passengerId).emit('rideAccepted', {
      message: data.message || 'ယာဉ်မောင်းမှ ခရီးစဉ်ကို လက်ခံလိုက်ပါပြီ။',
      driverId: socket.id,
      driverLat: data.driverLat,
      driverLng: data.driverLng
    });
  });

  socket.on('driverLocationUpdate', data => {
    if (!data || !data.passengerId) return;
    io.to(data.passengerId).emit('driverLocationUpdate', { lat: data.lat, lng: data.lng });
  });

  socket.on('driverArrived', data => {
    if (data && data.passengerId) io.to(data.passengerId).emit('driverArrived', data);
  });

  socket.on('finishRide', data => {
    if (!data || !data.passengerId) return;
    io.to(data.passengerId).emit('rideFinished', data);
    io.to(data.passengerId).emit('rideCompleted', data);
  });

  socket.on('disconnect', () => {
    if (socket.driverPhone && onlineDrivers[socket.driverPhone] === socket.id) {
      delete onlineDrivers[socket.driverPhone];
      io.emit('updateDriverStatus', { phone: socket.driverPhone, status: 'offline' });
    }
    socket.broadcast.emit('removePassengerMarker', { passengerId: socket.id });
    console.log('Socket disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ride-hailing server running on http://localhost:${PORT}`);
});
