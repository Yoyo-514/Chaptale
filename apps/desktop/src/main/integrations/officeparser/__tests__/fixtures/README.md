# officeparser 测试夹具

这些文件由测试维护者使用标准库生成，不来自第三方文档：

- `sample.pdf`：单页、原生文本层的最小 PDF。
- `sample.docx`：包含一个正文段落的最小 OOXML 文档。
- `sample.pptx`：包含一页文本幻灯片的最小 OOXML 演示文稿。
- `sample.xlsx`：包含一个内联字符串单元格的最小 OOXML 工作簿。
- `corrupt.docx`：故意伪装成 DOCX 的纯文本，用于验证损坏文件拒绝路径。

夹具只验证本地解析链路和 OCR 永久关闭约束，不用于代表复杂排版兼容性。
