import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import multer from "multer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Middlewares
app.use(cors());
// Set payload limit very high to support image uploads in base64 format (up to 50MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Multer config for in-memory uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Authentication
const getAdminPassword = async (): Promise<string> => {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { password: process.env.ADMIN_PASSWORD || "admin123" } });
  }
  return settings.password;
};

const authenticateAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Ruxsat etilmadi: Token topilmadi." });
    return;
  }
  const token = authHeader.replace("Bearer ", "");
  const currentPassword = await getAdminPassword();
  
  if (token === currentPassword) {
    next();
  } else {
    res.status(403).json({ error: "Ruxsat etilmadi: Noto'g'ri parol." });
  }
};

// --- API ROUTES ---

// 1. Get Portfolio Data
app.get("/api/portfolio", async (req, res) => {
  try {
    const profile = await prisma.profile.findFirst();
    const skills = await prisma.skill.findMany({ orderBy: { order: 'asc' } });
    const projects = await prisma.project.findMany({ orderBy: { order: 'asc' } });
    const education = await prisma.education.findMany({ orderBy: { order: 'asc' } });
    const workplaces = await prisma.workplace.findMany({ orderBy: { order: 'asc' } });
    const services = await prisma.service.findMany({ orderBy: { order: 'asc' } });
    const achievements = await prisma.achievement.findMany({ orderBy: { order: 'asc' } });

    // If profile is empty (first run), return an empty structure
    if (!profile) {
      return res.json({ profile: {}, skills: [], projects: [], education: [], workplaces: [], services: [], achievements: [] });
    }

    res.json({
      profile,
      skills,
      projects,
      education,
      workplaces,
      services,
      achievements
    });
  } catch (error) {
    console.error("GET /api/portfolio error:", error);
    res.status(500).json({ error: "Server ichki xatoligi" });
  }
});

// 2. Admin Login
app.post("/api/login", async (req, res) => {
  const { password } = req.body;
  const currentPassword = await getAdminPassword();
  if (password === currentPassword) {
    res.json({ success: true, token: password });
  } else {
    res.status(401).json({ success: false, error: "Noto'g'ri parol!" });
  }
});

// Update Password
app.post("/api/settings/password", authenticateAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 3) {
      return res.status(400).json({ error: "Parol juda qisqa!" });
    }
    await prisma.settings.update({
      where: { id: 1 },
      data: { password: newPassword }
    });
    res.json({ success: true, token: newPassword });
  } catch (error) {
    res.status(500).json({ error: "Server xatoligi" });
  }
});

// 3. Update Portfolio Data (Admin only)
app.post("/api/portfolio", authenticateAdmin, async (req, res) => {
  try {
    const data = req.body;
    
    // Update Profile
    if (data.profile) {
      const existing = await prisma.profile.findFirst();
      if (existing) {
        await prisma.profile.update({ where: { id: existing.id }, data: data.profile });
      } else {
        await prisma.profile.create({ data: data.profile });
      }
    }

    // A helper to sync arrays
    const syncTable = async (model: any, items: any[]) => {
      await model.deleteMany(); // Clear existing
      if (items && items.length > 0) {
        // Assign orders based on index
        const mapped = items.map((item: any, idx: number) => {
          const { id, ...rest } = item;
          return { ...rest, order: idx };
        });
        await model.createMany({ data: mapped });
      }
    };

    if (data.skills) await syncTable(prisma.skill, data.skills);
    if (data.projects) await syncTable(prisma.project, data.projects);
    if (data.education) await syncTable(prisma.education, data.education);
    if (data.workplaces) await syncTable(prisma.workplace, data.workplaces);
    if (data.services) await syncTable(prisma.service, data.services);
    if (data.achievements) await syncTable(prisma.achievement, data.achievements);

    res.json({ success: true, message: "Portfolio muvaffaqiyatli yangilandi!" });
  } catch (error) {
    console.error("POST /api/portfolio error:", error);
    res.status(500).json({ error: "Server ichki xatoligi" });
  }
});

// 4. Submit Contact Message
app.post("/api/messages", async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !message) {
      return res.status(400).json({ error: "Ism va xabar maydonlari majburiy." });
    }

    await prisma.message.create({
      data: { name, email, phone, message }
    });

    res.json({ success: true, message: "Xabar yuborildi." });
  } catch (error) {
    console.error("POST /api/messages xatolik:", error);
    res.status(500).json({ error: "Server xatoligi." });
  }
});

// 5. Get Messages (Admin)
app.get("/api/messages", authenticateAdmin, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({ orderBy: { date: 'desc' } });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Server xatoligi" });
  }
});

// 6. Delete Message (Admin)
app.delete("/api/messages/:id", authenticateAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.message.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Server xatoligi" });
  }
});

// 7. Mark Message as Read (Admin)
app.patch("/api/messages/:id/read", authenticateAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.message.update({
      where: { id },
      data: { read: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Server xatoligi" });
  }
});

// 8. Upload File directly as Base64 URL (Admin)
app.post("/api/upload", authenticateAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Fayl topilmadi" });
    }

    // Faylni Base64 formatiga o'tkazib, Data URL qilib qaytaramiz
    const b64 = Buffer.from(req.file.buffer).toString("base64");
    const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
    
    // Frontend bu dataURI ni oddiy link kabi qabul qilib, DB ga shu holaticha saqlaydi
    res.json({ url: dataURI });
  } catch (error) {
    console.error("Upload xatoligi:", error);
    res.status(500).json({ error: "Fayl ishlashda xatolik yuz berdi." });
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("Portfolio Backend API ishlamoqda. Vercel Frontend ga ulanishga tayyor.");
});

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
});

app.get("/api/seed", async (req, res) => {
  try {
    const profileCount = await prisma.profile.count();
    if (profileCount === 0) {
      await prisma.profile.create({
        data: {
          name: "Muhiddin Karimjonov",
          title: "Full Stack Dasturchi",
          bio: "Zamonaviy va ishonchli web loyihalar yarataman.",
          experienceYears: 2,
          email: "karimjonovmuhiddin13@gmail.com",
          phone: "+998 90 123 45 67",
          telegram: "https://t.me/username"
        }
      });
    } else {
      // Mavjud profilga tel va telegram qo'shish (agar bo'sh bo'lsa)
      await prisma.profile.updateMany({
        data: {
          phone: "+998 90 123 45 67",
          telegram: "https://t.me/username"
        }
      });
    }

    await prisma.skill.deleteMany();
    await prisma.skill.createMany({
      data: [
        { name: "HTML", category: "Frontend", level: 95, order: 1 },
        { name: "CSS", category: "Frontend", level: 90, order: 2 },
        { name: "JavaScript", category: "Frontend", level: 85, order: 3 },
        { name: "React.js", category: "Frontend", level: 80, order: 4 },
        { name: "TypeScript", category: "Frontend", level: 75, order: 5 },
        { name: "Tailwind CSS", category: "Frontend", level: 90, order: 6 },
        { name: "Node.js", category: "Backend", level: 70, order: 7 },
        { name: "Git", category: "Tools", level: 85, order: 8 }
      ]
    });

    await prisma.project.deleteMany();
    await prisma.project.createMany({
      data: [
        {
          title: "E-commerce Platformasi",
          description: "To'liq huquqli onlayn do'kon.",
          tags: ["React", "Node.js", "PostgreSQL"],
          order: 1
        },
        {
          title: "Portfolio Veb-sayti",
          description: "Zamonaviy va tezkor shaxsiy veb-sayt.",
          tags: ["React", "Tailwind CSS", "Vite"],
          order: 2
        },
        {
          title: "CRM Tizimi",
          description: "Mijozlar bilan ishlash uchun maxsus tizim.",
          tags: ["Next.js", "TypeScript", "Prisma"],
          order: 3
        }
      ]
    });

    await prisma.education.deleteMany();
    await prisma.education.create({
      data: {
        institution: "Najot Ta'lim",
        degree: "Full Stack Web Dasturlash",
        startYear: "2023",
        endYear: "2024",
        order: 1
      }
    });

    await prisma.service.deleteMany();
    await prisma.service.createMany({
      data: [
        { title: "Frontend Dasturlash", description: "Foydalanuvchilar uchun qulay va zamonaviy web interfeyslar yaratish (React, Vue, Tailwind).", iconName: "Monitor", order: 1 },
        { title: "Backend Dasturlash", description: "Mustahkam va xavfsiz server arxitekturasini qurish (Node.js, PostgreSQL).", iconName: "Server", order: 2 },
        { title: "UI/UX Dizayn", description: "Veb-saytlar uchun zamonaviy va jalb qiluvchi dizayn yechimlari.", iconName: "PenTool", order: 3 }
      ]
    });

    await prisma.workplace.deleteMany();
    await prisma.workplace.createMany({
      data: [
        { company: "Najot Ta'lim", role: "Mentor va O'qituvchi", duration: "2024 - Hozirgacha", description: "O'quvchilarga Full Stack dasturlash bo'yicha amaliy darslar o'tish va loyihalarda yordam berish.", order: 1 },
        { company: "Freelance", role: "Web Dasturchi", duration: "2023 - 2024", description: "Turli xil mijozlar uchun maxsus web sahifalar va tizimlar ishlab chiqish.", order: 2 }
      ]
    });

    await prisma.achievement.deleteMany();
    await prisma.achievement.createMany({
      data: [
        { title: "Eng Yaxshi Bitiruvchi Loyiha", description: "Najot Ta'lim o'quv markazida tayyorlangan CRM tizimi eng yaxshi loyiha deb topildi.", date: "Dekabr, 2023", order: 1 },
        { title: "Hackathon G'olibi", description: "Mahalliy dasturchilar musobaqasida jamoamiz bilan faxrli o'rinni egalladik.", date: "Mart, 2024", order: 2 }
      ]
    });

    res.json({ success: true, message: "Barcha ma'lumotlar to'liq tiklandi!" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

