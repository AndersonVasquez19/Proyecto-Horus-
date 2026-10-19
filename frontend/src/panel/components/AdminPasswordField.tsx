import { useState, type ChangeEvent } from 'react';
import PanelIcon from './PanelIcon';

interface AdminPasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  minLength?: number;
  maxLength?: number;
  invalid?: boolean;
  describedBy?: string;
}

export default function AdminPasswordField({ id, label, value, onChange, autoComplete, hint, minLength, maxLength, invalid, describedBy }: AdminPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="admin-auth__field">
      <label htmlFor={id}>{label}</label>
      <div className="admin-auth__password">
        <PanelIcon name="lock" size={18} />
        <input id={id} name={id} type={visible ? 'text' : 'password'} value={value}
          onChange={onChange} autoComplete={autoComplete} required minLength={minLength}
          maxLength={maxLength} placeholder={autoComplete === 'current-password' ? 'Tu contraseña' : 'Escribe tu contraseña'}
          aria-invalid={invalid || undefined}
          aria-describedby={[hint ? `${id}-hint` : '', invalid ? describedBy : ''].filter(Boolean).join(' ') || undefined} />
        <button type="button" className="admin-auth__password-toggle" onClick={() => setVisible(!visible)}
          aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={id}>
          <PanelIcon name={visible ? 'eye-off' : 'eye'} size={19} />
        </button>
      </div>
      {hint && <small id={`${id}-hint`} className="admin-auth__hint">{hint}</small>}
    </div>
  );
}
