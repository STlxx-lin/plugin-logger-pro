import { Application } from '@nocobase/server';
import { Context } from 'koa';

export interface AuditExportOptions {
  format?: 'csv' | 'xlsx';
  fields?: string[];
  filter?: any;
  limit?: number;
}

export const ALL_AUDIT_EXPORT_FIELDS: Record<string, string> = {
  createdAt: '发生时间',
  reqId: '请求ID',
  username: '操作用户名',
  userId: '用户ID',
  ip: '客户端IP',
  method: '请求方法',
  path: '请求路径',
  collectionName: '数据表(Collection)',
  actionName: '操作动作(Action)',
  recordId: '目标记录ID',
  statusCode: '状态码',
  durationMs: '耗时(ms)',
  diffSummary: '变更字段摘要',
  previousData: '变更前快照(JSON)',
  newData: '变更后快照(JSON)',
};

export class AuditExportService {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  // 格式化单元格数据
  private formatCellValue(key: string, record: any): string {
    const val = record[key];
    if (val === null || val === undefined) return '';
    if (key === 'createdAt') {
      try {
        return new Date(val).toLocaleString();
      } catch {
        return String(val);
      }
    }
    if (key === 'diffSummary') {
      if (typeof val === 'string') return val;
      if (typeof val === 'object') {
        const changes = Object.keys(val);
        return changes.length > 0 ? changes.join(', ') : '无变更';
      }
      return '';
    }
    if (key === 'previousData' || key === 'newData') {
      if (typeof val === 'object') {
        try {
          return JSON.stringify(val);
        } catch {
          return '';
        }
      }
      return String(val);
    }
    return String(val);
  }

  // 生成 CSV 格式字符串
  private generateCsv(records: any[], selectedFieldKeys: string[]): string {
    const headerRow = selectedFieldKeys.map((k) => `"${(ALL_AUDIT_EXPORT_FIELDS[k] || k).replace(/"/g, '""')}"`).join(',');
    const rows = records.map((rec) => {
      return selectedFieldKeys
        .map((k) => {
          let val = this.formatCellValue(k, rec);
          // 中和 CSV 公式注入：Excel 会将以 = + - @ 等开头的单元格解析为公式/DDE 执行
          if (/^[=+\-@\t\r]/.test(val)) {
            val = `'${val}`;
          }
          // 转义双引号
          return `"${val.replace(/"/g, '""')}"`;
        })
        .join(',');
    });

    // 加上 UTF-8 BOM (\uFEFF) 确保 Windows Excel 打开中文不乱码
    return '\uFEFF' + [headerRow, ...rows].join('\r\n');
  }

  // 生成 Excel XML Spreadsheet 格式 (原生支持 Excel 打开，无外部依赖)
  private generateExcelXml(records: any[], selectedFieldKeys: string[]): string {
    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1890FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
  </Style>
  <Style ss:ID="NumberCell">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="审计操作记录">
  <Table ss:DefaultRowHeight="20">
`;

    // 表头列宽
    for (const key of selectedFieldKeys) {
      const width = key.includes('Data') ? 250 : key === 'createdAt' ? 140 : key === 'reqId' ? 200 : 110;
      xml += `   <Column ss:Width="${width}"/>\n`;
    }

    // 表头行
    xml += '   <Row ss:Height="26">\n';
    for (const key of selectedFieldKeys) {
      const title = ALL_AUDIT_EXPORT_FIELDS[key] || key;
      xml += `    <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(title)}</Data></Cell>\n`;
    }
    xml += '   </Row>\n';

    // 数据行
    for (const rec of records) {
      xml += '   <Row>\n';
      for (const key of selectedFieldKeys) {
        const val = this.formatCellValue(key, rec);
        const isNum = (key === 'statusCode' || key === 'durationMs') && !isNaN(Number(val));
        if (isNum && val !== '') {
          xml += `    <Cell ss:StyleID="NumberCell"><Data ss:Type="Number">${val}</Data></Cell>\n`;
        } else {
          xml += `    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>\n`;
        }
      }
      xml += '   </Row>\n';
    }

    xml += `  </Table>
 </Worksheet>
</Workbook>`;

    return xml;
  }

  // 执行导出并设置响应流
  async exportLogs(ctx: Context, options: AuditExportOptions) {
    const repo = this.app.db.getRepository('logger_audit_logs');
    if (!repo) {
      ctx.throw(500, 'Audit log repository not initialized');
    }

    const format = options.format || 'xlsx';
    const limit = Math.min(options.limit || 10000, 50000);
    const selectedFields = options.fields && options.fields.length > 0 ? options.fields : Object.keys(ALL_AUDIT_EXPORT_FIELDS);

    // 查询记录
    const records = await repo.find({
      filter: options.filter || {},
      sort: ['-createdAt'],
      limit,
    });

    const now = new Date();
    const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    if (format === 'csv') {
      const csvContent = this.generateCsv(records, selectedFields);
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="audit_logs_${timeStr}.csv"`);
      ctx.body = csvContent;
    } else {
      const xmlContent = this.generateExcelXml(records, selectedFields);
      ctx.set('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="audit_logs_${timeStr}.xls"`);
      ctx.body = xmlContent;
    }
  }
}
