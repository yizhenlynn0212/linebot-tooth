// linebot-fb-course.js
const line = require('@line/bot-sdk');
const express = require('express');
const puppeteer = require('puppeteer');
const dayjs = require('dayjs');
const app = express();

const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
let browser;

const chromium = require('chrome-aws-lambda');

async function startBrowser() {
    browser = await chromium.puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
    });
    console.log('✅ Puppeteer browser started on Render');
}

app.post('/webhook', line.middleware(config), (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then(result => res.json(result))
        .catch(err => {
            console.error(err);
            res.status(500).end();
        });
});

async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') return null;
    const text = event.message.text.trim();
    try {
        if (text === '查詢本月牙科課程') {
            const dentall = await fetchThisMonthCourses();
            const facebook = await fetchFacebookCourses();
            const replyText = dentall + '\n\n' + facebook;
            return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
        } else {
            const replyText = await fetchCoursesPuppeteer(text);
            return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
        }
    } catch (err) {
        console.error('handleEvent Error:', err);
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '發生未預期的錯誤，請稍後再試。'
        });
    }
}

async function fetchCoursesPuppeteer(keyword) {
    let page;
    try {
        if (!browser) return '瀏覽器尚未啟動';
        page = await browser.newPage();
        await page.goto('https://www.dentall.io/course_entity', { waitUntil: 'networkidle2' });
        await page.waitForSelector('input[name="keyword"]');
        await page.click('input[name="keyword"]', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type('input[name="keyword"]', keyword);
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 2000));

        const courses = await page.evaluate(() => {
            const list = [];
            document.querySelectorAll('.course-card-content').forEach(card => {
                const title = card.querySelector('.course-card-name')?.innerText.trim() || '無標題';
                const date = card.querySelector('.course-card-date')?.innerText.trim() || '無日期';
                const lecturer = card.querySelector('.course-card-lecturer')?.innerText.trim() || '無講師';
                const url = card.closest('a')?.href || '無連結';
                list.push({ title, date, lecturer, url });
            });
            return list;
        });

        if (courses.length === 0) return '找不到相關課程喔嗚嗚！';
        let reply = '找到以下相關課程：\n\n';
        courses.forEach((c, i) => {
            reply += `${i + 1}. ${c.title}\n📅 ${c.date}\n👨‍🏫 ${c.lecturer}\n🔗 ${c.url}\n\n`;
        });
        return reply;
    } catch (err) {
        console.error('fetchCoursesPuppeteer Error:', err);
        return '查詢課程發生錯誤';
    } finally {
        if (page) await page.close();
    }
}

async function fetchThisMonthCourses() {
    let page;
    try {
        if (!browser) return '瀏覽器尚未啟動';
        page = await browser.newPage();
        await page.goto('https://www.dentall.io/course_entity', { waitUntil: 'networkidle2' });
        await page.waitForSelector('.course-card-content');
        await new Promise(r => setTimeout(r, 2000));

        const courses = await page.evaluate(() => {
            const list = [];
            document.querySelectorAll('.course-card-content').forEach(card => {
                const title = card.querySelector('.course-card-name')?.innerText.trim() || '無標題';
                const date = card.querySelector('.course-card-date')?.innerText.trim() || '無日期';
                const lecturer = card.querySelector('.course-card-lecturer')?.innerText.trim() || '無講師';
                const url = card.closest('a')?.href || '無連結';
                list.push({ title, date, lecturer, url });
            });
            return list;
        });

        const now = dayjs();
        const filtered = courses.filter(c => {
            const d = c.date.split('-')[0]?.trim();
            if (!/^\d{4}/.test(d)) return false;
            const dt = dayjs(d, 'YYYY/MM/DD');
            return dt.year() === now.year() && dt.month() + 1 === now.month() + 1;
        });

        if (filtered.length === 0) return '本月沒有牙科通課程';

        let reply = '【台灣牙醫通】本月課程：\n\n';
        filtered.forEach((c, i) => {
            reply += `${i + 1}. ${c.title}\n📅 ${c.date}\n👨‍🏫 ${c.lecturer}\n🔗 ${c.url}\n\n`;
        });
        return reply;
    } catch (err) {
        console.error('fetchThisMonthCourses Error:', err);
        return '抓取牙醫通課程時錯誤';
    } finally {
        if (page) await page.close();
    }
}

async function fetchFacebookCourses() {
    const fbUrl = 'https://www.facebook.com/whitedentalgroup';
    let page;
    try {
        if (!browser) return '';
        page = await browser.newPage();
        await page.goto(fbUrl, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        const posts = await page.evaluate(() => {
            const list = [];
            const now = new Date();
            document.querySelectorAll('div[role="article"]').forEach(node => {
                const text = node.querySelector('[data-ad-preview="message"]')?.innerText || node.innerText || '';
                const dateText = node.querySelector('abbr')?.innerText || node.querySelector('time')?.innerText || '';
                if (text.includes('課程')) {
                    list.push({ text, date: dateText });
                }
            });
            return list;
        });

        if (posts.length === 0) return '本月 Facebook 無課程貼文';

        let reply = '【White Dental Group】本月課程貼文：\n\n';
        posts.forEach((p, i) => {
            reply += `${i + 1}. ${p.text.slice(0, 100)}...\n📅 ${p.date}\n\n`;
        });
        return reply;

    } catch (err) {
        console.error('fetchFacebookCourses Error:', err);
        return '';
    } finally {
        if (page) await page.close();
    }
}

app.listen(3000, async () => {
    await startBrowser();
    console.log('🤖 Bot is running on port 3000');
});

/*const config = {
    channelAccessToken: '1/8Anxuj6rdoH3f0RMtLCOGTZXdP+lCR4oiyM9fgFs5cL9xaSveEsqiE29p4EYtF9l0mUdsaE3peaIknzAtj+8IQmrLQp77ibqvy5hHUe6DX1SZr69MhkgdUV9GMhtf9DGbT63HcFHH6W+eX2fnZVAdB04t89/1O/w1cDnyilFU=',
    channelSecret: '2081846d048b723dd7769e89f32eb137',
};*/