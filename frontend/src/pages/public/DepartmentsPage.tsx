import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { EP } from '../../api/endpoints.js';

interface Department {
  _id: string;
  name: string;
  description?: string;
}

/** S-02 Doctor & Department Directory (EP-08 public endpoint) */
export function DepartmentsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-departments'],
    queryFn: async () => {
      const res = await api.get<{ data: Department[] }>(EP.PUBLIC_DEPARTMENTS);
      return res.data.data;
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Departments & Doctors</h1>
      <p className="mt-1 text-sm text-slate-600">Browse our clinical departments.</p>

      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading departments…</p>}
      {isError && <p className="mt-6 text-sm text-red-600">Could not load departments. Please try again.</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((dept) => (
          <div key={dept._id} className="rounded-lg border p-4 transition hover:shadow-sm">
            <p className="font-semibold text-primary-700">{dept.name}</p>
            <p className="mt-1 text-sm text-slate-600">{dept.description ?? 'Clinical services'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
