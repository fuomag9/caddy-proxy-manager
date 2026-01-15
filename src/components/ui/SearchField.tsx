
import { InputAdornment, TextField, TextFieldProps } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

export function SearchField(props: TextFieldProps) {
    return (
        <TextField
            placeholder="Search..."
            variant="outlined"
            size="small"
            slotProps={{
                input: {
                    startAdornment: (
                        <InputAdornment position="start">
                            <SearchIcon sx={{ color: "text.secondary" }} />
                        </InputAdornment>
                    )
                }
            }}
            sx={{
                maxWidth: 400,
                "& .MuiOutlinedInput-root": {
                    bgcolor: "background.paper",
                    transition: "all 0.2s",
                    "&:hover": {
                        bgcolor: "action.hover"
                    },
                    "&.Mui-focused": {
                        bgcolor: "background.paper",
                        boxShadow: "0 4px 20px rgba(0,0,0,0.2)"
                    }
                }
            }}
            {...props}
        />
    );
}
