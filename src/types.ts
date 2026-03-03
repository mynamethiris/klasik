export interface User {
  id: number;
  name: string;
  account_code?: string;
  role: 'admin' | 'pj';
  group_name?: string;
  member_id?: number;
}

export interface ClassMember {
  id: number;
  name: string;
  pj_id?: number;
  pj_name?: string;
  pj_group?: string;
  is_pj_group?: string;
}

export interface AbsentMember {
  id: number;
  report_id: number;
  name: string;
  reason: string;
}

export interface Report {
  id: number;
  date: string;
  pj_id: number;
  pj_name?: string;
  pj_group?: string;
  checkin_photo: string;
  checkin_time: string;
  status: string;
  latitude: number;
  longitude: number;
  cleaning_photo: string;
  cleaning_description: string;
  submitted_at?: string;
  absents?: AbsentMember[];
}

export interface Schedule {
  id: number;
  group_name: string;
  day: string;
  created_at: string;
}
