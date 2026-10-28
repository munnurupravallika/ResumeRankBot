require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const pdf = require("pdf-parse");

// Initialize Telegram Bot with polling
const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
});

// Suppress temporary internet connection errors (ENOTFOUND)
bot.on("polling_error", (error) => {
    if (error.code === "EFATAL" || error.code === "ENOTFOUND") {
        // Suppress temporary network disconnect logs
        return;
    }
    console.error("Polling error:", error.message);
});

console.log("🤖 Resume Rank Bot Started");

// ======================================================
// STORE DATA SEPARATELY FOR EACH TELEGRAM USER
// ======================================================

const users = {};

function getUser(chatId) {
    if (!users[chatId]) {
        users[chatId] = {
            jobDescription: "",
            resumes: [],
            lastResults: null
        };
    }
    return users[chatId];
}

// ======================================================
// SKILLS DATABASE
// ======================================================

const skillsList = [
    // Programming Languages
    "java", "python", "c++", "c", "javascript", "typescript",
    // Web Development
    "html", "css", "react", "react.js", "node", "node.js", "express", "express.js",
    // Databases
    "sql", "mysql", "mongodb", "postgresql", "mariadb",
    // CS Fundamentals
    "data structures", "algorithms", "dsa", "object oriented programming", "oop", "operating systems", "database management", "dbms",
    // DSA Topics
    "sorting", "searching", "dynamic programming", "graph", "graphs", "tree", "trees", "recursion", "linked list", "stack", "queue",
    // Problem Solving
    "problem solving", "problem-solving", "competitive programming", "coding", "coding problems",
    // Coding Platforms
    "leetcode", "hackerrank", "codechef", "codeforces",
    // Software
    "software development", "software", "application development",
    // Tools
    "git", "github",
    // Cloud
    "aws", "azure", "gcp", "google cloud",
    // AI & Machine Learning
    "artificial intelligence", "machine learning", "ai", "ml"
];

// Helper to escape Markdown special characters safely to avoid Telegram 400 errors
function safeMarkdown(text) {
    if (!text) return "";
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// ======================================================
// START COMMAND
// ======================================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    getUser(chatId);

    bot.sendMessage(
        chatId,
        `🤖 Welcome to Resume Rank Bot!

This bot compares multiple resumes with a Job Description, extracts CGPA, ranks applicants, and answers ANY question about candidates.

Commands:
/jd - Enter Job Description
/rank - Rank all uploaded resumes & show CGPA
/courses - Get course recommendations
/reset - Start a new screening

Steps:
1️⃣ Type /jd
2️⃣ Paste the Job Description
3️⃣ Upload multiple PDF resumes
4️⃣ Type /rank

You can also ask ANY question in plain English, such as:
• "Who has the best CGPA?"
• "Why did Nuha get a low score?"
• "Does Pradeep know Python?"
• "Which candidate should I hire?"`
    );
});

// ======================================================
// JOB DESCRIPTION COMMAND
// ======================================================

bot.onText(/\/jd/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
        `📄 Please paste the Job Description.

Example:
Company: Tech Mahindra
Role: Expert Programmer
Required Skills:
Java
C++
Data Structures
Algorithms
Dynamic Programming
Graphs
Trees
Competitive Programming
Problem Solving`
    );
});

// ======================================================
// UNIVERSAL Q&A HANDLER (ANSWERS ANY QUESTION)
// ======================================================

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    // Ignore commands & documents
    if (!msg.text || msg.text.startsWith("/") || msg.document) {
        return;
    }

    const user = getUser(chatId);

    // 1. Save Job Description if not set yet
    if (!user.jobDescription) {
        user.jobDescription = msg.text;
        bot.sendMessage(
            chatId,
            `✅ Job Description saved successfully!

Now upload multiple PDF resumes.

You can upload:
📄 Resume 1
📄 Resume 2
📄 Resume 3
📄 Resume 4

After uploading all resumes, type:
/rank`
        );
        return;
    }

    // 2. Process ANY text question
    bot.sendChatAction(chatId, "typing");

    try {
        const answer = await answerAnyQuestion(msg.text, user);
        bot.sendMessage(chatId, answer, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Error answering question:", err);
        bot.sendMessage(
            chatId,
            "I could not process that specific question. Type /rank to view overall candidate rankings or upload PDF resumes."
        );
    }
});

// ======================================================
// QA ENGINE (NO EXTRA NPM PACKAGES REQUIRED)
// ======================================================

async function answerAnyQuestion(userQuery, userSession) {
    const apiKey = process.env.GEMINI_API_KEY;

    // Optional Gemini REST API call if GEMINI_API_KEY is provided in .env
    if (apiKey) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const prompt = `
You are CareerFitBot, an AI HR Recruitment Assistant.
Answer the user's question about candidate resumes and job screening.

[JOB DESCRIPTION]
${userSession.jobDescription || "Not set yet"}

[CANDIDATE ANALYSIS RESULTS]
${JSON.stringify(userSession.lastResults || [], null, 2)}

[USER QUESTION]
"${userQuery}"

Provide a clear, accurate, direct, and professional answer based on the candidate data.
`;
            const response = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }]
            });

            if (response.data && response.data.candidates && response.data.candidates[0].content.parts[0].text) {
                return response.data.candidates[0].content.parts[0].text;
            }
        } catch (err) {
            console.log("Using local QA processor:", err.message);
        }
    }

    // Built-in smart local fallback processor
    return processLocalQuestion(userQuery, userSession);
}

function processLocalQuestion(userQuery, userSession) {
    const text = userQuery.toLowerCase();
    const results = userSession.lastResults || [];

    if (results.length === 0) {
        return "⚠️ Please upload PDF resumes and run `/rank` first so I can analyze candidate data!";
    }

    // A. Query about CGPA
    if (text.includes("cgpa") || text.includes("gpa") || text.includes("marks") || text.includes("grades")) {
        const sortedByCGPA = [...results].sort((a, b) => (b.cgpaNumeric || 0) - (a.cgpaNumeric || 0));
        const bestCGPA = sortedByCGPA[0];

        return `🌟 *HIGHEST CGPA CANDIDATE DETAILS*\n\n` +
            `📄 *File:* ${safeMarkdown(bestCGPA.filename)}\n` +
            `🎓 *CGPA / Grade:* ${safeMarkdown(bestCGPA.cgpa)}\n` +
            `📊 *Match Score:* ${bestCGPA.score}/100\n` +
            `🎯 *Selection Chance:* ${bestCGPA.chance}\n\n` +
            `✅ *MATCHED SKILLS:*\n${formatList(bestCGPA.matched)}\n\n` +
            `❌ *MISSING / WEAK SKILLS:*\n${formatList(bestCGPA.missing)}\n\n` +
            `💡 *FEEDBACK:*\n${formatList(bestCGPA.feedback)}\n\n` +
            `📚 *RECOMMENDED COURSES:*\n${formatList(bestCGPA.courses)}`;
    }

    // B. Query about Skills
    if (text.includes("skill") || text.includes("skills") || text.includes("matched")) {
        const sortedBySkills = [...results].sort((a, b) => b.matched.length - a.matched.length);
        const topSkills = sortedBySkills[0];

        return `🌟 *MOST MATCHED SKILLS CANDIDATE DETAILS*\n\n` +
            `📄 *File:* ${safeMarkdown(topSkills.filename)}\n` +
            `📊 *Matched Skills Count:* ${topSkills.matched.length}\n` +
            `🎓 *CGPA:* ${safeMarkdown(topSkills.cgpa)}\n` +
            `🎯 *Selection Chance:* ${topSkills.chance}\n\n` +
            `✅ *MATCHED SKILLS:*\n${formatList(topSkills.matched)}\n\n` +
            `❌ *MISSING / WEAK SKILLS:*\n${formatList(topSkills.missing)}\n\n` +
            `💡 *FEEDBACK:*\n${formatList(topSkills.feedback)}\n\n` +
            `📚 *RECOMMENDED COURSES:*\n${formatList(topSkills.courses)}`;
    }

    // C. Search for specific candidate by filename/name
    for (const cand of results) {
        const simpleName = cand.filename.split(".")[0].toLowerCase();
        if (text.includes(simpleName) || simpleName.split(" ").some(part => part.length > 3 && text.includes(part))) {
            return `📄 *CANDIDATE ANALYSIS FOR ${safeMarkdown(cand.filename)}*\n\n` +
                `📊 *Match Score:* ${cand.score}/100\n` +
                `🎓 *CGPA / Grade:* ${safeMarkdown(cand.cgpa)}\n` +
                `🎯 *Selection Chance:* ${cand.chance}\n\n` +
                `✅ *MATCHED SKILLS:*\n${formatList(cand.matched)}\n\n` +
                `❌ *MISSING SKILLS:*\n${formatList(cand.missing)}\n\n` +
                `💡 *FEEDBACK:*\n${formatList(cand.feedback)}\n\n` +
                `📚 *RECOMMENDED COURSES:*\n${formatList(cand.courses)}`;
        }
    }

    // D. Default Best Match Candidate
    const top = results[0];
    return `🏆 *BEST MATCH CANDIDATE DETAILS*\n\n` +
        `📄 *File:* ${safeMarkdown(top.filename)}\n` +
        `📊 *Match Score:* ${top.score}/100\n` +
        `🎓 *CGPA / Grade:* ${safeMarkdown(top.cgpa)}\n` +
        `🎯 *Selection Chance:* ${top.chance}\n\n` +
        `✅ *MATCHED SKILLS:*\n${formatList(top.matched)}\n\n` +
        `❌ *MISSING / WEAK SKILLS:*\n${formatList(top.missing)}\n\n` +
        `💡 *FEEDBACK:*\n${formatList(top.feedback)}\n\n` +
        `📚 *RECOMMENDED COURSES:*\n${formatList(top.courses)}`;
}

// ======================================================
// RESUME PDF UPLOAD HANDLER
// ======================================================

bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const user = getUser(chatId);

    // Verify PDF file
    if (!msg.document.mime_type || msg.document.mime_type !== "application/pdf") {
        bot.sendMessage(chatId, "❌ Please upload a valid PDF resume.");
        return;
    }

    try {
        bot.sendMessage(chatId, `⏳ Reading resume: ${msg.document.file_name}`);

        const fileId = msg.document.file_id;
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

        // Download PDF
        const response = await axios({
            method: "GET",
            url: fileUrl,
            responseType: "arraybuffer",
            timeout: 60000
        });

        // Parse PDF text
        const pdfData = await pdf(response.data);
        const resumeText = pdfData.text || "";

        // Store resume in user session
        user.resumes.push({
            filename: msg.document.file_name,
            text: resumeText
        });

        console.log(`Resume uploaded: ${msg.document.file_name}`);

        bot.sendMessage(
            chatId,
            `✅ Resume uploaded successfully!\n\n📄 File:\n${msg.document.file_name}\n\n📊 Total resumes uploaded:\n${user.resumes.length}\n\nUpload another resume or type:\n/rank`
        );
    } catch (error) {
        console.error("PDF ERROR:", error.message);
        bot.sendMessage(chatId, "❌ Error reading PDF. Please try uploading the resume again.");
    }
});

// ======================================================
// RANK RESUMES COMMAND (SAFE CHUNKING)
// ======================================================

bot.onText(/\/rank/, async (msg) => {
    const chatId = msg.chat.id;
    const user = getUser(chatId);

    if (!user.jobDescription) {
        bot.sendMessage(chatId, "❌ Please enter the Job Description first using /jd.");
        return;
    }

    if (user.resumes.length === 0) {
        bot.sendMessage(chatId, "❌ Please upload at least one PDF resume.");
        return;
    }

    bot.sendMessage(chatId, `🔍 Analyzing ${user.resumes.length} resume(s)...\n\nPlease wait.`);

    // Analyze all resumes against JD
    const results = user.resumes.map((resume) => {
        const analysis = analyzeResume(resume.text, user.jobDescription);

        return {
            filename: resume.filename,
            score: analysis.score,
            cgpa: analysis.cgpa,
            cgpaNumeric: analysis.cgpaNumeric,
            chance: getChance(analysis.score),
            matched: analysis.matched,
            missing: analysis.missing,
            feedback: analysis.feedback,
            courses: analysis.courses
        };
    });

    // Sort descending by match score
    results.sort((a, b) => b.score - a.score);

    // Save evaluation results for Q&A answers
    user.lastResults = results;

    const bestMatch = results[0];
    const sortedByCGPA = [...results].sort((a, b) => b.cgpaNumeric - a.cgpaNumeric);
    const bestCGPACandidate = sortedByCGPA[0];

    // Summary Leaderboard
    let overviewMsg = `🏆 *BEST MATCH RESUME FOR THIS JOB*\n\n🥇 *${safeMarkdown(bestMatch.filename)}*\n📊 Best Score: *${bestMatch.score}/100*\n🎓 CGPA: *${safeMarkdown(bestMatch.cgpa)}*\n🎯 Chance: *${bestMatch.chance}*\n\n`;

    overviewMsg += `🌟 *HIGHEST CGPA CANDIDATE*\n🎓 *${safeMarkdown(bestCGPACandidate.filename)}* (CGPA: ${safeMarkdown(bestCGPACandidate.cgpa)})\n\n`;

    overviewMsg += `━━━━━━━━━━━━━━━━━━━━\n🏆 *COMPLETE RESUME RANKING*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    results.forEach((result, index) => {
        overviewMsg += `${index + 1}. *${safeMarkdown(result.filename)}*\n📊 Score: ${result.score}/100 | 🎓 CGPA: ${safeMarkdown(result.cgpa)}\n🎯 Chance: ${result.chance}\n\n`;
    });

    await bot.sendMessage(chatId, overviewMsg, { parse_mode: 'Markdown' });

    // Detailed Cards in separate messages to avoid 4096 char limit
    await bot.sendMessage(chatId, `━━━━━━━━━━━━━━━━━━━━\n📋 *DETAILED CANDIDATE FEEDBACK*\n━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });

    for (let index = 0; index < results.length; index++) {
        const result = results[index];
        let cardMsg = `🏅 *RANK ${index + 1}: ${safeMarkdown(result.filename)}*\n\n` +
            `📊 *Match Score:* ${result.score}/100\n` +
            `🎓 *CGPA / Grade:* ${safeMarkdown(result.cgpa)}\n` +
            `🎯 *Chance:* ${result.chance}\n\n` +
            `✅ *MATCHED SKILLS:*\n${formatList(result.matched)}\n\n` +
            `❌ *MISSING / WEAK SKILLS:*\n${formatList(result.missing)}\n\n` +
            `💡 *FEEDBACK:*\n${formatList(result.feedback)}\n\n` +
            `📚 *RECOMMENDED COURSES:*\n${formatList(result.courses)}`;

        await bot.sendMessage(chatId, cardMsg, { parse_mode: 'Markdown' });
    }
});

// ======================================================
// ANALYZE RESUME LOGIC (DETERMINISTIC MATCH & CGPA)
// ======================================================

function analyzeResume(resumeText, jobDescription) {
    const resume = normalizeText(resumeText);
    const jd = normalizeText(jobDescription);

    const jobSkills = extractSkills(jd);
    const resumeSkills = extractSkills(resume);

    const matched = jobSkills.filter((skill) => resumeSkills.includes(skill));
    const missing = jobSkills.filter((skill) => !resumeSkills.includes(skill));

    // Deterministic match percentage
    let score = 0;
    if (jobSkills.length > 0) {
        score = Math.round((matched.length / jobSkills.length) * 100);
    }

    const cgpaInfo = extractCGPA(resumeText);
    const feedbackData = getFeedback(missing);

    return {
        score: score,
        cgpa: cgpaInfo.text,
        cgpaNumeric: cgpaInfo.numeric,
        matched: matched,
        missing: missing,
        feedback: feedbackData.feedback,
        courses: feedbackData.courses
    };
}

// ======================================================
// CGPA EXTRACTION FUNCTION
// ======================================================

function extractCGPA(rawText) {
    const patterns = [
        /(?:cgpa|gpa|sgpa)\s*[:\-=]?\s*([0-9]\.[0-9]{1,2})/i,
        /([0-9]\.[0-9]{1,2})\s*(?:cgpa|gpa|sgpa|\/10|\/4)/i,
        /(?:cgpa|gpa)\s*[:\-=]?\s*([10]\.0{1,2})/i,
        /(?:percentage|aggregate|marks)\s*[:\-=]?\s*([0-9]{2}(?:\.[0-9]{1,2})?)\s*%/i,
        /([0-9]{2}(?:\.[0-9]{1,2})?)\s*%/i
    ];

    for (const pattern of patterns) {
        const match = rawText.match(pattern);
        if (match && match[1]) {
            const num = parseFloat(match[1]);
            if (num <= 10.0) {
                return { text: `${num} / 10`, numeric: num };
            } else if (num <= 100.0) {
                return { text: `${num}%`, numeric: num / 10 };
            }
        }
    }

    return { text: "Not specified", numeric: 0 };
}

// ======================================================
// EXTRACT SKILLS
// ======================================================

function extractSkills(text) {
    const found = [];
    skillsList.forEach((skill) => {
        if (text.includes(skill.toLowerCase())) {
            found.push(skill);
        }
    });
    return [...new Set(found)];
}

// ======================================================
// NORMALIZE TEXT
// ======================================================

function normalizeText(text) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// ======================================================
// GET SELECTION CHANCE
// ======================================================

function getChance(score) {
    if (score >= 80) return "HIGH";
    if (score >= 60) return "MEDIUM";
    return "LOW";
}

// ======================================================
// FEEDBACK & COURSE RECOMMENDATION GENERATOR
// ======================================================

function getFeedback(missingSkills) {
    const feedback = [];
    const courses = [];

    if (missingSkills.length === 0) {
        feedback.push("Excellent! Your resume contains all detected skills from the Job Description.");
        courses.push(
            "Advanced Data Structures and Algorithms",
            "Competitive Programming",
            "System Design"
        );
        return { feedback, courses };
    }

    missingSkills.forEach((skill) => {
        switch (skill) {
            case "java":
                feedback.push("Improve Java programming and OOP concepts.");
                courses.push("Java Programming and OOP");
                break;
            case "python":
                feedback.push("Add Python projects and strengthen Python programming.");
                courses.push("Python Programming");
                break;
            case "c++":
                feedback.push("Learn C++ programming and STL for competitive programming.");
                courses.push("C++ Programming and STL");
                break;
            case "data structures":
                feedback.push("Strengthen Data Structures knowledge and add DSA problems solved to your resume.");
                courses.push("Data Structures and Algorithms");
                break;
            case "algorithms":
                feedback.push("Practice algorithm design and complexity analysis.");
                courses.push("Algorithms and Problem Solving");
                break;
            case "dsa":
                feedback.push("Strengthen DSA concepts and mention relevant problems or projects.");
                courses.push("Complete DSA Course");
                break;
            case "dynamic programming":
                feedback.push("Practice Dynamic Programming problems.");
                courses.push("Dynamic Programming");
                break;
            case "graph":
            case "graphs":
                feedback.push("Learn Graph algorithms such as BFS, DFS, and shortest paths.");
                courses.push("Graph Algorithms");
                break;
            case "tree":
            case "trees":
                feedback.push("Strengthen Tree and Binary Tree concepts.");
                courses.push("Trees and Advanced Data Structures");
                break;
            case "sorting":
                feedback.push("Practice sorting algorithms and understand their time complexity.");
                courses.push("Sorting Algorithms");
                break;
            case "searching":
                feedback.push("Practice searching algorithms including Binary Search.");
                courses.push("Searching Algorithms");
                break;
            case "problem solving":
            case "problem-solving":
                feedback.push("Improve problem-solving skills by solving coding problems regularly.");
                courses.push("Problem Solving and Coding");
                break;
            case "competitive programming":
                feedback.push("Practice competitive programming contests.");
                courses.push("Competitive Programming");
                break;
            case "coding":
            case "coding problems":
                feedback.push("Solve more coding problems and add measurable achievements to your resume.");
                courses.push("Coding Interview Preparation");
                break;
            case "leetcode":
                feedback.push("Practice more problems on LeetCode and mention problem-solving achievements.");
                courses.push("LeetCode DSA Practice");
                break;
            case "hackerrank":
                feedback.push("Practice coding challenges on HackerRank.");
                courses.push("HackerRank Problem Solving");
                break;
            case "codechef":
                feedback.push("Participate in CodeChef contests.");
                courses.push("CodeChef Competitive Programming");
                break;
            case "codeforces":
                feedback.push("Practice competitive programming on Codeforces.");
                courses.push("Codeforces Competitive Programming");
                break;
            case "software":
            case "software development":
                feedback.push("Add software development projects and clearly describe your contribution.");
                courses.push("Software Development Fundamentals");
                break;
            case "javascript":
                feedback.push("Strengthen JavaScript fundamentals and add JavaScript projects.");
                courses.push("Modern JavaScript");
                break;
            case "react":
            case "react.js":
                feedback.push("Learn React components, hooks, and state management.");
                courses.push("React.js Development");
                break;
            case "node":
            case "node.js":
                feedback.push("Improve Node.js backend development skills.");
                courses.push("Node.js Backend Development");
                break;
            case "sql":
                feedback.push("Practice SQL queries and database design.");
                courses.push("SQL and Database Fundamentals");
                break;
            case "mongodb":
                feedback.push("Strengthen MongoDB database concepts.");
                courses.push("MongoDB Fundamentals");
                break;
            case "git":
            case "github":
                feedback.push("Learn Git version control and GitHub workflows.");
                courses.push("Git and GitHub");
                break;
            default:
                feedback.push(`Improve ${skill} skills and add related projects or achievements to your resume.`);
                courses.push(`${skill} Fundamentals`);
        }
    });

    return {
        feedback: [...new Set(feedback)],
        courses: [...new Set(courses)]
    };
}

// ======================================================
// FORMAT LIST UTILITY
// ======================================================

function formatList(items) {
    if (!items || items.length === 0) {
        return "• None detected";
    }
    return items.map((item) => `• ${safeMarkdown(item)}`).join("\n");
}

// ======================================================
// COURSES COMMAND
// ======================================================

bot.onText(/\/courses/, (msg) => {
    const chatId = msg.chat.id;
    const user = getUser(chatId);

    if (!user.jobDescription) {
        bot.sendMessage(chatId, "❌ Please enter a Job Description first using /jd.");
        return;
    }

    const jobSkills = extractSkills(normalizeText(user.jobDescription));
    const feedbackData = getFeedback(jobSkills);

    bot.sendMessage(
        chatId,
        `📚 COURSE RECOMMENDATIONS\n\nBased on the Job Description:\n\n${formatList(feedbackData.courses)}\n\nThese are general recommendations based on detected Job Description skills.`
    );
});

// ======================================================
// RESET COMMAND
// ======================================================

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    users[chatId] = {
        jobDescription: "",
        resumes: [],
        lastResults: null
    };

    bot.sendMessage(
        chatId,
        `🔄 Screening reset successfully!\n\nUse /jd to enter a new Job Description.`
    );
});