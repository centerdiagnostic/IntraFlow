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
            if (sigBase64) return `<img src="${sigBase64}" style="max-height: 40px; max-width: 180px; vertical-align: bottom; margin: 0 5px;">`;
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

app.listen(port, () => {
    console.log(`Backend Server รันสำเร็จแล้วที่ http://localhost:${port}`);
    console.log(`พร้อมรับคำสั่ง Export PDF จากหน้าเว็บ!`);
});
