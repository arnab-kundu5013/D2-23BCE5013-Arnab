import { v4 as uuidv4 } from 'uuid';
import db from './sqlite';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileRecord {
  id: string;
  original_name: string;
  stored_path: string;
  file_type: 'pdf' | 'docx' | 'image' | 'audio';
  mime_type: string;
  size_bytes: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  tags: string;
  description: string | null;
  chunks_indexed: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrossModalLink {
  id: string;
  source_file_id: string;
  target_file_id: string;
  source_chunk_id: string | null;
  target_chunk_id: string | null;
  link_type: string;
  confidence: number;
  created_at: string;
}

export interface FileStats {
  file_type: string;
  status: string;
  count: number;
  total_size: number;
  total_chunks: number;
}

// ── File queries ──────────────────────────────────────────────────────────────

export async function insertFile(record: Omit<FileRecord, 'id'>): Promise<FileRecord> {
  const id = uuidv4();
  const row: FileRecord = { id, ...record };
  await db('files').insert(row);
  return row;
}

export async function getFileById(id: string): Promise<FileRecord | undefined> {
  return db('files').where({ id }).first();
}

export async function updateFileStatus(
  id: string,
  status: FileRecord['status'],
): Promise<void> {
  await db('files').where({ id }).update({ status, updated_at: new Date().toISOString() });
}

export async function updateFileChunksIndexed(id: string, count: number): Promise<void> {
  await db('files')
    .where({ id })
    .update({ chunks_indexed: count, updated_at: new Date().toISOString() });
}

export async function markFileFailed(id: string, message: string): Promise<void> {
  await db('files').where({ id }).update({
    status: 'failed',
    error_message: message,
    updated_at: new Date().toISOString(),
  });
}

export interface ListFilesParams {
  type?: string;
  status?: string;
  page: number;
  limit: number;
}

export async function listFiles(params: ListFilesParams): Promise<{ rows: FileRecord[]; total: number }> {
  const { type, status, page, limit } = params;
  const offset = (page - 1) * limit;

  let query = db('files').orderBy('created_at', 'desc');
  if (type) query = query.where('file_type', type);
  if (status) query = query.where('status', status);

  const countQuery = query.clone().count('* as total').first<{ total: number }>();
  const rowsQuery = query.clone().limit(limit).offset(offset).select<FileRecord[]>('*');

  const [{ total }, rows] = await Promise.all([countQuery, rowsQuery]);
  return { rows, total: Number(total) };
}

export async function deleteFileById(id: string): Promise<void> {
  await db('files').where({ id }).delete();
}

// ── Cross-modal link queries ──────────────────────────────────────────────────

export async function insertCrossModalLink(
  link: Omit<CrossModalLink, 'id'>,
): Promise<CrossModalLink> {
  const id = uuidv4();
  const row: CrossModalLink = { id, ...link };
  await db('cross_modal_links').insert(row);
  return row;
}

export async function listAllLinks(): Promise<CrossModalLink[]> {
  return db('cross_modal_links').orderBy('confidence', 'desc').select('*');
}

export async function getLinksBySourceFile(sourceFileId: string): Promise<CrossModalLink[]> {
  return db('cross_modal_links')
    .where('source_file_id', sourceFileId)
    .orderBy('confidence', 'desc')
    .select('*');
}

export async function deleteLinksByFileId(fileId: string): Promise<void> {
  await db('cross_modal_links')
    .where('source_file_id', fileId)
    .orWhere('target_file_id', fileId)
    .delete();
}

// ── Stats query ───────────────────────────────────────────────────────────────

export async function getFileStats(): Promise<FileStats[]> {
  return db('files')
    .select('file_type', 'status')
    .count('* as count')
    .sum('size_bytes as total_size')
    .sum('chunks_indexed as total_chunks')
    .groupBy('file_type', 'status') as Promise<FileStats[]>;
}
