const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const port = 3000;

// ตั้งค่า CORS แบบอนุญาตทุกอย่าง (ป้องกัน Error 100%)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
// ขยาย limit เป็น 50mb เพื่อรองรับการส่งภาพลายเซ็น Base64 ขนาดใหญ่
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.post('/api/export-pdf', async (req, res) => {
    const docData = req.body;
    let browser;
    
    try {
        // เพิ่มคำสั่งปิด Sandbox เพื่อให้รันบน Cloud/Linux ได้
        browser = await puppeteer.launch({ 
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote'
            ]
        });
        const page = await browser.newPage();

        // จัดการข้อมูล Array รายการทดสอบให้แสดงผลเป็น Text
        const formatTests = (tests, singleName, singleCode) => {
            if (tests && tests.length > 0) return tests.map(t => `${t.name} ${t.code ? `(Code: ${t.code})` : ''}`).join(', ');
            return `${singleName || ''} ${singleCode ? `(Code: ${singleCode})` : ''}`.trim();
        };
        const cancelTestsText = formatTests(docData.cancelTests, docData.cancelTestName, docData.cancelTestCode);
        const newTestsText = formatTests(docData.newTests, docData.newTestName, docData.newTestCode);

        // ฟังก์ชันแปลงวันที่ให้รองรับข้อมูลจาก Firestore เพื่อแก้ปัญหา Invalid Date
        const parseDate = (val) => {
            if (!val) return '......../......../........';
            if (val.seconds) return new Date(val.seconds * 1000).toLocaleDateString('th-TH');
            const d = new Date(val);
            return isNaN(d.getTime()) ? '......../......../........' : d.toLocaleDateString('th-TH');
        };
        const reqDate = parseDate(docData.createdAt);
        const appDate = parseDate(docData.approvedAt);
        const procDate = parseDate(docData.processedAt);

        const renderSign = (sigBase64, name) => {
            // ปรับขนาดใหม่: บังคับกล่องขนาด กว้าง 180px สูง 70px (ใหญ่ขึ้นเกือบ 2 เท่า)
            // ใช้ object-fit: contain เพื่อให้ลายเซ็นจัดกึ่งกลางและไม่บิดเบี้ยว ไม่ว่าจะอัปโหลดขนาดไหนมา
            // ปรับ margin เพื่อให้ลายเซ็นวางทับเส้นประได้สวยงาม
            if (sigBase64) return `<img src="${sigBase64}" style="width: 180px; height: 70px; object-fit: contain; vertical-align: bottom; margin: -10px 5px 0 5px;">`;
            return `<span class="sign-line" style="color: #000;">${name || ''}</span>`;
        };
        const reqSignHtml = renderSign(docData.requesterSignature, docData.requesterName);
        const appSignHtml = (docData.status === 'approved' || docData.status === 'rejected') ? renderSign(docData.approverSignature, docData.approverName) : '';
        const procSignHtml = docData.isProcessed ? renderSign(docData.processedBySignature, docData.processedByName || docData.processedBy) : '';

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
                
                /* บังคับความสูงเต็มหน้ากระดาษและใช้ Flexbox ดันลายเซ็นลงล่าง */
                html, body { height: 100%; margin: 0; padding: 0; }
                body { 
                    font-family: 'Sarabun', sans-serif; 
                    padding: 40px; 
                    box-sizing: border-box; 
                    color: #000; 
                    line-height: 1.4; 
                    font-size: 15px; 
                    display: flex; 
                    flex-direction: column; 
                }
                
                .main-content { flex: 1; }
                .signature-container { margin-top: auto; padding-bottom: 20px; }
                
                .header-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
                .header-table td { vertical-align: top; }
                .logo-cell { width: 90px; padding-right: 15px; }
                .logo { width: 85px; height: auto; }
                .header-title { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
                .header-subtitle { 
                    font-size: 11px; 
                    margin: 0 0 2px 0; 
                    white-space: nowrap; 
                    overflow: hidden; 
                }
                
                .section-header { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 15px; margin-bottom: 8px; }
                .section-title { font-weight: bold; font-size: 17px; margin: 0; }
                .ar-text { font-weight: bold; font-size: 15px; }
                
                .row { display: flex; margin-bottom: 6px; }
                .col-label { width: 160px; }
                .col-data { flex: 1; border-bottom: 1px dotted #000; padding-left: 5px; }
                
                .checkbox-item { display: flex; align-items: flex-start; margin-bottom: 5px; }
                .box { width: 13px; height: 13px; border: 1px solid #000; margin-right: 8px; margin-top: 4px; display: flex; justify-content: center; align-items: center; font-size: 13px; font-weight: bold; flex-shrink: 0; }
                
                .sign-requester { display: flex; justify-content: flex-end; margin-top: 10px; padding-right: 20px; }
                .sign-box { text-align: center; }
                .sign-line { display: inline-block; border-bottom: 1px dotted #000; width: 220px; margin: 0 5px; text-align: center; vertical-align: bottom; line-height: 1.2; }
                
                .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="main-content">
                <table class="header-table">
                    <tr>
                        <td class="logo-cell">
                            <img class="logo" src="https://kvdc-vetku.com/wp-content/uploads/2026/03/1.png" alt="Logo">
                        </td>
                        <td>
                            <div class="header-title">แบบฟอร์มคำขอยกเลิกบริการทดสอบ (cancel test)</div>
                            <p class="header-subtitle">ศูนย์ชันสูตรโรคสัตว์ กำแพงแสน ศูนย์วิจัยและบริการวิชาการทางสัตวแพทย์ คณะสัตวแพทยศาสตร์ ม.เกษตรศาสตร์ วิทยาเขตกำแพงแสน</p>
                            <p class="header-subtitle">Kamphaengsaen Veterinary Diagnostic Center, Faculty of Veterinary Medicine, Kasetsart University</p>
                        </td>
                    </tr>
                </table>
                
                <div class="section-header">
                    <div class="section-title">1. รายการทดสอบที่ต้องการขอยกเลิก</div>
                    <div class="ar-text">เลขที่คำร้อง AR: ${docData.arNumber || '-'}</div>
                </div>
                
                <div class="row"><div class="col-label">วันที่ส่งตัวอย่าง</div><div class="col-data">${docData.receiveDate || ''}</div></div>
                <div class="row"><div class="col-label">ห้องปฏิบัติการ</div><div class="col-data">${docData.labRoom || ''}</div></div>
                <div class="row"><div class="col-label">หมายเลข Folder</div><div class="col-data">${docData.folderNumber || ''}</div></div>
                <div class="row"><div class="col-label">เลขที่ใบเสร็จรับเงิน</div><div class="col-data">${docData.receiptNumber || ''}</div></div>
                <div class="row"><div class="col-label">เลขที่ใบแจ้งหนี้</div><div class="col-data">${docData.invoiceNumber || ''}</div></div>

                <div class="section-title" style="margin-top: 15px; margin-bottom: 8px;">2. เหตุผลในการยกเลิกรายการทดสอบ</div>
                <div style="padding-left: 10px;">
                    <div class="checkbox-item"><div class="box">${docData.cancelReason === 'ลูกค้าขอยกเลิก' ? '✓' : ''}</div> ลูกค้าขอยกเลิก</div>
                    <div class="checkbox-item"><div class="box">${docData.cancelReason === 'ตัวอย่างไม่สมบูรณ์ / ไม่เป็นไปตามเกณฑ์' ? '✓' : ''}</div> ตัวอย่างไม่สมบูรณ์ / ไม่เป็นไปตามเกณฑ์</div>
                    <div class="checkbox-item"><div class="box">${docData.cancelReason === 'ข้อมูลตัวอย่างไม่ถูกต้อง' ? '✓' : ''}</div> ข้อมูลตัวอย่างไม่ถูกต้อง</div>
                    <div class="checkbox-item"><div class="box">${docData.cancelReason === 'ทดสอบซ้ำ / รายการซ้ำ' ? '✓' : ''}</div> ทดสอบซ้ำ / รายการซ้ำซ้อน</div>
                    <div class="checkbox-item">
                        <div class="box">${docData.cancelReason === 'อื่นๆ' ? '✓' : ''}</div> 
                        <div style="flex: 1; display: flex;">อื่น ๆ (ระบุ) <span style="border-bottom: 1px dotted #000; flex: 1; margin-left: 10px; padding-left: 5px;">${docData.cancelReason === 'อื่นๆ' ? (docData.cancelReasonOther || '') : ''}</span></div>
                    </div>
                    <div style="margin-top: 10px; display: flex;">รายละเอียดเพิ่มเติม : <span style="border-bottom: 1px dotted #000; flex: 1; margin-left: 10px; padding-left: 5px;">${docData.description || ''}</span></div>
                </div>

                <div class="section-title" style="margin-top: 15px; margin-bottom: 8px;">3. โดยขอให้แก้ไขรายละเอียดดังนี้</div>
                <div style="padding-left: 10px;">
                    <div class="checkbox-item">
                        <div class="box">${cancelTestsText ? '✓' : ''}</div> 
                        <div style="flex: 1; display: flex;">ชื่อรายการทดสอบที่ยกเลิก / test code : <span style="border-bottom: 1px dotted #000; flex: 1; margin-left: 10px; padding-left: 5px;">${cancelTestsText}</span></div>
                    </div>
                    <div class="checkbox-item" style="margin-top: 6px;">
                        <div class="box">${newTestsText ? '✓' : ''}</div> 
                        <div style="flex: 1; display: flex;">ชื่อรายการทดสอบที่เพิ่มใหม่ / test code : <span style="border-bottom: 1px dotted #000; flex: 1; margin-left: 10px; padding-left: 5px;">${newTestsText}</span></div>
                    </div>
                </div>
            </div> 
            
            <div class="sign-requester" style="margin-top: 30px; margin-bottom: 30px;">
                <div class="sign-box">
                    ลงชื่อ ${reqSignHtml} ผู้เสนอขอยกเลิก<br>
                    <div style="margin-top: 4px;">( ${docData.requesterName || '.......................................................'} )</div>
                    <div style="margin-top: 2px;">วันที่ขอแก้ไข ${reqDate}</div>
                </div>
            </div>

            <div class="signature-container">
                <div class="bottom-grid">
                    <div>
                        <div class="section-title" style="margin-top: 0;">4. ผู้อนุมัติ</div>
                        <div style="padding-left: 10px; margin-top: 8px;">
                            <div class="checkbox-item"><div class="box">${docData.status === 'approved' ? '✓' : ''}</div> อนุมัติให้ดำเนินการได้</div>
                            <div class="checkbox-item"><div class="box">${docData.status === 'rejected' ? '✓' : ''}</div> ไม่อนุมัติให้ดำเนินการ เนื่องจาก <span style="border-bottom: 1px dotted #000; flex: 1; margin-left: 5px; padding-left: 5px;">${docData.rejectReason || ''}</span></div>
                        </div>
                        <div class="sign-box" style="margin-top: 15px;">
                            ลงชื่อ ${appSignHtml}<br>
                            <div style="margin-top: 4px;">( ${docData.approverName || '.......................................................'} )</div>
                            <div style="margin-top: 2px;">ผู้อำนวยการศูนย์ชันสูตรโรคสัตว์ กำแพงแสน</div>
                            <div style="margin-top: 2px;">วันที่ ${docData.status === 'pending' ? '......../......../........' : appDate}</div>
                        </div>
                    </div>
                    <div>
                        <div class="section-title" style="margin-top: 0;">5. บันทึกข้อมูลลงระบบเรียบร้อยแล้ว</div>
                        <div class="sign-box" style="margin-top: 50px;">
                            ลงชื่อ ${procSignHtml}<br>
                            <div style="margin-top: 4px;">( ${docData.isProcessed ? (docData.processedByName || docData.processedBy || '') : '.......................................................'} )</div>
                            <div style="margin-top: 2px;">ผู้ดำเนินการแก้ไขในระบบ</div>
                            <div style="margin-top: 2px;">วันที่ ${docData.isProcessed ? procDate : '......../......../........'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;

        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' } // ย้าย margin ไปควบคุมผ่าน padding ใน css แทน
        });

        // บังคับแนบ Header ตอบกลับ
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Cancel_Test_${docData.arNumber || Date.now()}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF');
    } finally {
        if (browser) await browser.close();
    }
});

app.post('/api/export-temp-log', async (req, res) => {
    console.log("--> เริ่มกระบวนการสร้าง PDF อุณหภูมิ:", req.body.eq?.name);
    const { eq, logs, thMonth, chartBase64, year, month, userMap = {} } = req.body;
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
        });
        const page = await browser.newPage();

        let thDays = '';
        for(let i=1; i<=31; i++) thDays += `<th class="col-day">${i}</th>`;

        const rows = [
            { key: 'm-val', label: 'เช้า (ค่าจริง)' },
            { key: 'm-adj', label: 'เช้า (±ค่าแก้)' },
            { key: 'm-user', label: 'ผู้บันทึก (เช้า)' },
            { key: 'a-val', label: 'บ่าย (ค่าจริง)' },
            { key: 'a-adj', label: 'บ่าย (±ค่าแก้)' },
            { key: 'a-user', label: 'ผู้บันทึก (บ่าย)' }
        ];

        let trs = '';
        rows.forEach(r => {
            trs += `<tr><td class="col-label">${r.label}</td>`;
            for(let i=1; i<=31; i++) {
                const dateStr = `${year}-${month}-${i.toString().padStart(2, '0')}`;
                const dailyLogs = logs.filter(l => l.dateKey === dateStr || l.timestamp.startsWith(dateStr));
                const logMorning = dailyLogs.find(l => l.shift === 'เช้า' || (!l.shift && l.timestamp.includes('T0')));
                const logAfternoon = dailyLogs.find(l => l.shift === 'บ่าย');
                
                // ฟังก์ชันช่วยดึงชื่อหรือลายเซ็น
                const getUserDisplay = (email) => {
                    if (!email) return '';
                    const u = userMap[email];
                    if (u && u.signature) return `<img src="${u.signature}" style="height: 12px; max-width: 100%; object-fit: contain;">`;
                    if (u && u.name) return u.name.split(' ')[0]; // ถ้าไม่มีรูป เอาแค่ชื่อตัวแรก
                    return email.split('@')[0].substring(0, 8); // เผื่อกรณีข้อมูลเก่าที่ไม่มีชื่อ
                };

                let cellVal = '';
                if(r.key === 'm-val' && logMorning) cellVal = logMorning.value;
                if(r.key === 'm-user' && logMorning) cellVal = getUserDisplay(logMorning.createdBy);
                if(r.key === 'a-val' && logAfternoon) cellVal = logAfternoon.value;
                if(r.key === 'a-user' && logAfternoon) cellVal = getUserDisplay(logAfternoon.createdBy);
                
                trs += `<td class="col-day">${cellVal}</td>`;
            }
            trs += `</tr>`;
        });

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
                
                /* ใช้ Flexbox คุมความสูงหน้ากระดาษ (98vh) เพื่อจัดการตำแหน่งของแต่ละส่วนได้อิสระ */
                body { 
                    font-family: 'Sarabun', sans-serif; 
                    margin: 0;
                    padding: 15px 20px; 
                    box-sizing: border-box; 
                    color: #000; 
                    line-height: 1.2; 
                    width: 100%; 
                    height: 98vh; 
                    display: flex;
                    flex-direction: column;
                }
                
                /* ส่วนหัว (Header) ตามต้นฉบับเป๊ะ */
                .header-wrap { 
                    display: flex; 
                    justify-content: space-between; 
                    border-bottom: 2px solid #000; 
                    padding-bottom: 8px; 
                    margin-bottom: 12px; 
                }
                .header-left { display: flex; align-items: flex-start; gap: 15px; }
                .ku-logo { color: #006666; font-size: 42px; font-weight: bold; line-height: 0.8; font-family: Arial, sans-serif; letter-spacing: -1px; }
                .header-text-container { padding-top: 2px; }
                .title-text { font-size: 16px; font-weight: bold; margin: 0 0 4px 0; }
                .subtitle-text { font-size: 10px; margin: 0 0 2px 0; }
                .subtitle-eng { font-size: 9px; margin: 0; color: #333; }
                
                /* ส่วนข้อมูลอุปกรณ์ (Info Row) ทำเส้นจุดประเลียนแบบฟอร์ม */
                .info-row { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 15px; width: 100%; gap: 10px; }
                .info-item { display: flex; align-items: flex-end; flex: 1; white-space: nowrap; }
                .info-dot-line { border-bottom: 1px dotted #000; flex: 1; margin: 0 5px; text-align: center; font-weight: bold; padding-bottom: 1px; overflow: hidden; text-overflow: ellipsis; }
                
                /* ตาราง (Table) */
                table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 10px; }
                th, td { border: 1px solid #000; text-align: center; vertical-align: middle; padding: 2px 0; overflow: hidden; }
                .col-label { width: 10%; text-align: left; padding-left: 4px; font-size: 9px; }
                .col-day { width: 2.9%; font-size: 8px; font-weight: normal; }
                
                /* สร้างเส้นทแยงมุม วันที่/เวลา */
                .diag-cell { position: relative; padding: 0; }
                .diag-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
                .diag-date { position: absolute; top: 1px; right: 2px; font-size: 8px; z-index: 2; }
                .diag-time { position: absolute; bottom: 1px; left: 2px; font-size: 8px; z-index: 2; }

                /* ส่วนกราฟ (Chart) ให้ขยายกลืนกินพื้นที่ว่างทั้งหมด (flex-grow: 1) */
                .chart-section {
                    flex-grow: 1; 
                    display: flex;
                    flex-direction: column;
                    margin-bottom: 15px;
                }
                .chart-title { font-size: 11px; font-weight: bold; margin-bottom: 5px; }
                .chart-container {
                    flex-grow: 1;
                    border: 1px solid #000;
                    width: 100%;
                    position: relative;
                }
                /* ให้รูปภาพเต็มพื้นที่ของ Container ที่ขยายแล้ว */
                .chart-container img {
                    position: absolute;
                    top: 0; left: 0; width: 100%; height: 100%;
                    object-fit: contain;
                }

                /* ส่วนลายเซ็นผู้ตรวจสอบ (Footer) จะถูกดันลงไปล่างสุดโดยอัตโนมัติ */
                .footer { text-align: right; font-size: 12px; margin-right: 20px; }
            </style>
        </head>
        <body>
            <div class="header-wrap">
                <div class="header-left">
                    <div class="ku-logo">KU</div>
                    <div class="header-text-container">
                        <h1 class="title-text">บันทึกอุณหภูมิเครื่องมือ</h1>
                        <p class="subtitle-text">หน่วยงานชันสูตรโรคสัตว์ กำแพงแสน ศูนย์วิจัยและบริการวิชาการทางสัตวแพทย์ ม.เกษตรศาสตร์ วิทยาเขตกำแพงแสน</p>
                        <p class="subtitle-eng">Kamphaengsaen Veterinary Diagnostic Center, Faculty of Veterinary Medicine, Kasetsart University</p>
                    </div>
                </div>
                <div style="font-size: 10px; align-self: flex-start;">F6.4-0603-10/Rev.01/17-08-63</div>
            </div>

            <div class="info-row">
                <div class="info-item" style="flex: 2.5;">
                    <span>เครื่องมือ</span>
                    <div class="info-dot-line">${eq.name}</div>
                </div>
                <div class="info-item" style="flex: 1.5;">
                    <span>รหัสเครื่องมือ</span>
                    <div class="info-dot-line">${eq.assetNumber || '-'}</div>
                </div>
                <div class="info-item" style="flex: 1.5;">
                    <span>ช่วงอุณหภูมิที่ใช้งาน</span>
                    <div class="info-dot-line">${eq.operatingValue || '-'}</div>
                    <span>°C</span>
                </div>
                <div class="info-item" style="flex: 1;">
                    <span>ค่าแก้</span>
                    <div class="info-dot-line">-</div>
                </div>
                <div class="info-item" style="flex: 1.5;">
                    <span>ประจำเดือน</span>
                    <div class="info-dot-line">${thMonth}</div>
                </div>
            </div>

            <table>
                <tr>
                    <th class="col-label diag-cell">
                        <svg class="diag-svg" preserveAspectRatio="none" viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100" stroke="black" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
                        <span class="diag-date">วันที่</span>
                        <span class="diag-time">เวลา</span>
                    </th>
                    ${thDays}
                </tr>
                ${trs}
            </table>

            <div class="chart-section">
                <div class="chart-title">อุณหภูมิ (°C)</div>
                <div class="chart-container">
                    ${chartBase64 ? `<img src="${chartBase64}">` : ''}
                </div>
            </div>

            <div class="footer">
                ผู้ตรวจสอบ ..............................................................<br><br>......../......../........
            </div>
        </body>
        </html>`;

        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        console.log("--> เริ่มแปลง PDF แนวนอน...");
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '5mm', right: '5mm', bottom: '5mm', left: '5mm' } // ลด Margin ลงเพื่อไม่ให้ตารางล้นขอบ
        });

        console.log("--> สร้าง PDF สำเร็จ ส่งกลับเป็น Base64");
        // บังคับแปลง Uint8Array ให้เป็น Buffer ก่อนแปลง Base64 (สำคัญสำหรับ Puppeteer รุ่นใหม่)
        const validBase64 = Buffer.from(pdfBuffer).toString('base64');
        res.status(200).json({
            filename: `Report_${eq.id}_${year}_${month}.pdf`,
            pdfBase64: validBase64
        });

    } catch (error) {
        console.error('--> Error ในการสร้าง PDF:', error);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างไฟล์ PDF' });
    } finally {
        if (browser) await browser.close();
    }
});

app.post('/api/export-usage-log', async (req, res) => {
    console.log("--> เริ่มกระบวนการสร้าง PDF Usage Log:", req.body.eq?.name);
    const { eq, logs } = req.body;
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
        });
        const page = await browser.newPage();

        const formatDateTime = (iso) => {
            if (!iso) return '-';
            const d = new Date(iso);
            return d.toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        };

        let trs = '';
        logs.forEach((l, index) => {
            trs += `
                <tr>
                    <td class="text-center">${index + 1}</td>
                    <td>${formatDateTime(l.start)}</td>
                    <td>${formatDateTime(l.end)}</td>
                    <td>${l.name || '-'}</td>
                    <td>${l.purpose || '-'}</td>
                    <td class="text-center">${l.count || 1}</td>
                </tr>
            `;
        });

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
                body { 
                    font-family: 'Sarabun', sans-serif; 
                    margin: 0; padding: 30px 40px; 
                    color: #000; line-height: 1.4; 
                }
                .header-wrap { 
                    display: flex; justify-content: space-between; align-items: flex-start;
                    border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; 
                }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .ku-logo { color: #006666; font-size: 50px; font-weight: bold; line-height: 0.8; font-family: Arial, sans-serif; letter-spacing: -1px; margin-top: 5px;}
                .title-text { font-size: 20px; font-weight: bold; margin: 0; }
                .subtitle-text { font-size: 13px; margin: 2px 0 0 0; }
                
                .info-grid {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; font-size: 14px;
                }
                .info-item span { font-weight: bold; width: 120px; display: inline-block; }
                
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
                th { background-color: #f2f2f2; font-weight: bold; padding: 8px; border: 1px solid #000; text-align: center; }
                td { padding: 6px 8px; border: 1px solid #000; vertical-align: top; }
                .text-center { text-align: center; }
                
                .footer { text-align: right; font-size: 12px; margin-top: 30px; color: #555; }
            </style>
        </head>
        <body>
            <div class="header-wrap">
                <div class="header-left">
                    <div class="ku-logo">KU</div>
                    <div>
                        <div class="title-text">รายงานประวัติการใช้งานเครื่องมือ (Usage Logbook)</div>
                        <div class="subtitle-text">ศูนย์ชันสูตรโรคสัตว์ กำแพงแสน มหาวิทยาลัยเกษตรศาสตร์</div>
                    </div>
                </div>
            </div>

            <div class="info-grid">
                <div class="info-item"><span>ชื่อเครื่องมือ:</span> ${eq.name}</div>
                <div class="info-item"><span>หมายเลขครุภัณฑ์:</span> ${eq.assetNumber || '-'}</div>
                <div class="info-item"><span>สถานที่ติดตั้ง:</span> ${eq.location || '-'}</div>
                <div class="info-item"><span>พิมพ์รายงานเมื่อ:</span> ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 6%;">ลำดับ</th>
                        <th style="width: 17%;">เริ่มใช้งาน</th>
                        <th style="width: 17%;">สิ้นสุดใช้งาน</th>
                        <th style="width: 24%;">ชื่อผู้ใช้งาน</th>
                        <th style="width: 28%;">วัตถุประสงค์</th>
                        <th style="width: 8%;">จำนวน(คน)</th>
                    </tr>
                </thead>
                <tbody>
                    ${trs}
                </tbody>
            </table>
        </body>
        </html>`;

        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        console.log("--> เริ่มแปลง PDF Usage Log...");
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '15mm', left: '10mm' }
        });

        console.log("--> สร้าง PDF สำเร็จ ส่งกลับเป็น Base64");
        const validBase64 = Buffer.from(pdfBuffer).toString('base64');
        res.status(200).json({
            filename: `UsageLog_${eq.id}_${Date.now()}.pdf`,
            pdfBase64: validBase64
        });

    } catch (error) {
        console.error('--> Error ในการสร้าง PDF Usage Log:', error);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างไฟล์ PDF' });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(port, () => {
    console.log(`Backend Server รันสำเร็จแล้วที่ http://localhost:${port}`);
    console.log(`พร้อมรับคำสั่ง Export PDF จากหน้าเว็บ!`);
});
