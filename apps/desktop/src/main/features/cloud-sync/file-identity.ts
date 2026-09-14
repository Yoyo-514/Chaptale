/**
 * 一份文件的内容身份：路径、字节数、内容指纹。
 *
 * 归档清单与恢复比对都按这同一组事实对齐两侧，所以**只留一个名字**——
 * 两个同形类型只会让每次比较都在两套类型之间搬运。
 *
 * `relativePath` 一律是相对作品目录的路径、正斜杠、无前导斜杠：归档里的条目名与磁盘上的相对路径
 * 本来就该是同一个键，不然恢复时的比对要先把两边翻译一遍。
 */
export type FileIdentity = {
  relativePath: string;
  bytes: number;
  digest: string;
};
