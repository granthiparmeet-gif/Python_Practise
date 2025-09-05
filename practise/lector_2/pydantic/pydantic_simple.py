from pydantic import BaseModel

class Info(BaseModel):
    name : str
    age : int
    email : str

info = {
    "name" : "Parmeet",
    "age" : 32,
    "email" : "granthi.parmeet@gmail.com"
}

u_info = Info(**info)

print (u_info.name)
print(u_info.age)
print(u_info.email)
